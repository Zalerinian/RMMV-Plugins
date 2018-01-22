/*:
 * @plugindesc Writes all errors to a text file in a deployed game so that issues can be accurately reported. <ID: ze_trace_b4ucga>
 * @author Zalerinian
 *
 * @param level
 * @text Log Level
 * @desc The lowest level of events to log. Selecting None will effectively disable the log.
 * @type select
 * @option Error 
 * @option Warning
 * @option Info
 * @option Debug
 * @option None
 * @default Error
 *
 * @param file
 * @text Log File
 * @desc The file to use for logging. This is relative to game.exe, NOT the game's content. Default: Log.txt
 * @type text
 * @default Log.txt
 *
 * @help
 * ==============================================================================
 * * Overview
 * ==============================================================================
 * This plugin will write errors, warnings, and other messages to a log file for
 * desktop-deployed games. It will disable itself when deployed on the web, so
 * you don't have to worry about removing it for a web export.
 *
 * The types of messages logged by the plugin can be configured using the plugin
 * parameters.
 *
 * ==============================================================================
 * * Changing the behavior
 * ==============================================================================
 * The Trace plugin allows other plugins/developers to alter the logging level 
 * After the game has started. The logging level will be stored in Game_System,
 * and will default to the value define by the plugin if the value is not present
 * in a save.
 *
 * To change the log level of the trace plugin, use the Zale.Trace.setTraceLevel
 * function. You should use one of the constants in the Zale.Trace._Levels
 * object, or you may receive an error. It also helps make your code clearer as
 * to what level you're setting.
 *
 * To change the log file we're using, use the Zale.Trace.setTraceFile function,
 * which will make sure to close the previous file and manage the file handles.
 */

var Zale = Zale || {};
Zale.Trace = {};

(function() {
	'use strict'

	// The plugin is only available on desktop clients, as there is no file system access on the web,
	// and the console will always be available.
	if(Utils.isNwjs()) {
		Zale.Trace._Levels = {
			Error: 4,
			Warning: 3,
			Info: 2,
			Debug: 1,
			None: 0
		};

		Zale.Trace.Level = Zale.Trace._Levels.None;
		Zale.Trace._queue = [];
		Zale.Trace._queueIdx = 0;
		Zale.Trace._fileHandle = -1;
		Zale.Trace._fileHandleBackup = -1;
		Zale.Trace._writing = false;
		Zale.Trace._file = "";

		let fs = require('fs');
		let plugin = $plugins.filter(function(p) {
		  return p.description.contains('<ID: ze_trace_b4ucga>') && p.status
		})[0];

		if(plugin == null) {
			internalError("[Trace] Failed to load plugin parameters!");
			return;
		}

		// In order to prevent an infinite loop if there's an error in this plugin, we store the current
		// logging level, set the level to not log anything, log the error in the console as per usual,
		// and then reset the level so future calls to console.error go through the plugin.
		function internalError(message) {
			let level = Zale.Trace.Level;
			Zale.Trace.Level = Zale.Trace._Levels["None"];
			console.error(message);
			Zale.Trace.Level = level;
		}

		// Opens the specified path as the trace file, and store it so we
		// can keep trying to open it if it fails.
		function openTraceFile(path) {
			Zale.Trace._file = path;
			fs.open(path, "a", 0o666, handleFileOpen);
		}

		// If there was an error opening the file, try again in 5 seconds. Otherwise, set the 
		// file handle, mark that we're no longer switching files, and if we're not writing,
		// write a message if we need to.
		function handleFileOpen(err, fd) {
			if(err != null) {
				internalError("[Trace] Failed to open file for logging. Trying again with default file in 5 seconds.");
				internalError(err);
				setTimeout(function() { Zale.Trace.setTraceFile(Zale.Trace._file); }, 5000);
				return;
			}
			Zale.Trace._fileHandle = fd;
			if(!Zale.Trace._writing) {
				writeMessageIfNeeded();
			}
		}

		// IF we have a valid file handle and there are messages to be written, write them.
		// if the queue length and queue index are equal, then we clear the queue and set the
		// index back to 0, because we caught up with all our messages, and mark writing as false.
		// If we don't have any queued messages or a valid file handle, mark writing as false.
		// If we are writing, we're not done with the queue, and a valid file handle, write the next message!
		function writeMessageIfNeeded() {
			if(Zale.Trace._fileHandle >= 0) {
				if(Zale.Trace._queue.length > 0) {
					if(Zale.Trace._queue.length == Zale.Trace._queueIdx) {
						Zale.Trace._queue.length = 0;
						Zale.Trace._queueIdx = 0;
						Zale.Trace._writing = false;
						console.debug("Queue length and index reset!");
						return;
					} else {
						Zale.Trace._writing = true;
						let msg = Zale.Trace._queue[Zale.Trace._queueIdx];
						fs.write(Zale.Trace._fileHandle, "[" + msg.type.toUpperCase() + "] " + msg.message + "\r\n", null, 'utf8', verifyWrite);
					}
				} else {
					Zale.Trace._writing = false;
				}
			} else {
				Zale.Trace._writing = false;
			}
		}

		// Makes sure that there was no error when writing a message to the log. If there was, report it,
		// wait a second, and then try again, without incrementing the queue index so we try that
		// same message again.
		// If it didn't have an error, increment the queue index and see if another message needs to be written.
		function verifyWrite(err, bytesWritten, string) {
			if(err != null) {
				internalError("There was an error writing a message to the log file.");
				internalError(err);
				setTimeout(function() { writeMessageIfNeeded(); }, 1000);
				return;
			}
			Zale.Trace._queueIdx++;
			console.debug("Index: " + Zale.Trace._queueIdx);
			console.debug("Queue Length: " + Zale.Trace._queue.length);
			writeMessageIfNeeded();
		}

		// Verifies that the given value is a valid trace level, and then puts the new level in effect.
		Zale.Trace.setTraceLevel = function(level) {
			if(typeof Zale.Trace._Levels[level] === "number") {
				Zale.Trace.Level = Zale.Trace._Levels[level];
			} else {
				internalError("[Trace] " + level + " is not a valid trace level!");
			}
		}

		// Sets the file we're writing to. If there's already one open, make note of its file handle
		// incase we can't open the new one, and then close and discard the current file handle so
		// that the system will stop writing, instead queueing up any more messages.
		// If the close had an error, we restore the current file, verify that the system has stopped,
		// and then begin writing again.
		// If no file was open, we have nothing to close, so we just open the new one.
		Zale.Trace.setTraceFile = function(filepath) {
			if(Zale.Trace._fileHandle >= 0) {
				Zale.Trace._fileHandleBackup = Zale.Trace._fileHandle;
				fs.close(Zale.Trace._fileHandle, function(error) {
					if(error != null) {
						internalError("[Trace] Failed to close old log file");
						internalError(error);
						Zale.Trace._fileHandle = Zale.Trace._fileHandleBackup;
						Zale.Trace._fileHandleBackup = -1;
						if(!Zale.Trace._writing) {
							writeMessageIfNeeded();
						}
						return;
					}
					Zale.Trace._fileHandleBackup = -1;
					openTraceFile(filepath);
				});
				Zale.Trace._fileHandle = -1;
			} else {
				openTraceFile(filepath);
			}
		}

		// If we're not currently writing messages to the queue, try to start it.
		// We need the writing check because this is async recursion. writeMessageIfNeeded has verifyWrite
		// called as it's IO callback, which will then call writeMessageIfNeeded to write the next message
		// in the queue, or to clear the queue and index to free up memory, and to mark that we're no longer
		// writing.
		// If we didn't have this check and called writeMessageIfNeeded multiple times, the callbacks would
		// be called too many times, and we'd try to write a message that doesn't exist, and we'd crash.
		Zale.Trace.logMessage = function(type, message) {
			Zale.Trace._queue.push({type: type, message: message});
			if(!Zale.Trace._writing) {
				writeMessageIfNeeded();
				return;
			}
		}


		// Set the trace level and file according to the plugin parameters.
		Zale.Trace.setTraceLevel(plugin.parameters.level);
		Zale.Trace.setTraceFile(plugin.parameters.file);



		// Alias the console methods so that they add messages to the queue
		let console_error = console.error;
		console.error = function(msg) {
			if(Zale.Trace.Level <= Zale.Trace._Levels.Error) {
				Zale.Trace.logMessage("error", msg);
				writeMessageIfNeeded();
			}
			console_error.apply(this, arguments);
		}

		let console_warn = console.warn;
		console.warn = function(msg) {
			if(Zale.Trace.Level <= Zale.Trace._Levels.Warning) {
				Zale.Trace.logMessage("warn", msg);
				writeMessageIfNeeded();
			}
			console_warn.apply(this, arguments);
		}

		let console_log = console.log;
		console.log = function(msg) {
			if(Zale.Trace.Level <= Zale.Trace._Levels.Info) {
				Zale.Trace.logMessage("info", msg);
				writeMessageIfNeeded();
			}
			console_log.apply(this, arguments);
		}

		let console_info = console.info;
		console.info = function(msg) {
			if(Zale.Trace.Level <= Zale.Trace._Levels.Info) {
				Zale.Trace.logMessage("info", msg);
				writeMessageIfNeeded();
			}
			console_info.apply(this, arguments);
		}

		let console_debug = console.debug;
		console.debug = function(msg) {
			if(Zale.Trace.Level <= Zale.Trace._Levels.Debug) {
				Zale.Trace.logMessage("debug", msg);
				writeMessageIfNeeded();
			}
			console_debug.apply(this, arguments);
		}
	}
})();