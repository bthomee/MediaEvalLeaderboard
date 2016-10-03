// global imports
var fs = require('fs.extra');
var path = require('path');
var randtoken = require('rand-token');
var shutdown = require('shutdown');

// get database
var sqlite3 = require('sqlite3').verbose();

// create the database directory
try {
	app.logger.debug('opening database directory at ' + path.join(app.dir, app.config['base-dir'], app.config['db-dir']));
	fs.mkdirpSync(path.join(app.dir, app.config['base-dir'], app.config['db-dir']));
} catch (err) {
	app.logger.error('could not create database directory: ' + err);
}

// implement the database
var database = {
	// create database tables
	// note: use the text format for storing the score, so we can use a single field for storing the different kinds of
	//       values for both subtasks
	db: new sqlite3.Database(path.join(app.dir, app.config['base-dir'], app.config['db-dir'], app.config['db-store']))
		.run('PRAGMA foreign_keys=ON;')
		.run('CREATE TABLE IF NOT EXISTS users (name TEXT NOT NULL UNIQUE, email TEXT NOT NULL, token TEXT PRIMARY KEY, verified INTEGER NOT NULL)')
		.run('CREATE TABLE IF NOT EXISTS runs (token TEXT NOT NULL, timestamp INTEGER NOT NULL, state INTEGER NOT NULL, subtask TEXT NOT NULL, score1 REAL, score2 REAL, score3 REAL, comment TEXT NOT NULL, lastmodified INTEGER NOT NULL, FOREIGN KEY(token) REFERENCES users(token) ON DELETE CASCADE)'),

	// add a new user
	addUser: function(name, email, callback) {
		// validate details
		// note: we allow a name with a length between 3 and 24 characters containing only
		//       alphanumeric characters plus the dash and underscore
		var re1 = /^[A-Za-z0-9-_]{3,24}$/;
		if (!re1.test(name)) {
			app.logger.debug('name has an invalid format (name=' + name + ', email=' + email + ', token=' + token + ')');
			return callback({ title: 'Adding user failed', message: 'Name has an invalid format.' }, null);
		}
		var re2 = /^([\w-]+(?:\.[\w-]+)*)@((?:[\w-]+\.)*\w[\w-]{0,66})\.([a-z]{2,6}(?:\.[a-z]{2})?)$/i;
		if (!re2.test(email)) {
			app.logger.debug('email has an invalid format (name=' + name + ', email=' + email + ', token=' + token + ')');
			return callback({ title: 'Adding user failed', message: 'Email address has an invalid format.' }, null);
		}	
		// check if the name already exists
		database.db.get('SELECT COUNT(*) AS count FROM users WHERE LOWER(name)=?', name.toLowerCase(), function (err, ret) {
			if (err) {
				app.logger.debug('could not check user (name=' + name + ', email=' + email + ', token=' + token + ', err=' + err + ') in database');
				return callback({ title: 'Adding user failed', message: 'Could not access database.' }, null);
			}
			if (ret.count != 0) {
				app.logger.debug('name is already registered (name=' + name + ', email=' + email + ') in database');
				return callback({ title: 'Adding user failed', message: 'Name is already registered.' }, null);
			}
			// generate a unique token
			database.generateToken(function (err, token) {
				if (err) {
					app.logger.debug('could not generate unique token (name=' + name + ', email=' + email + ', token=' + token + ', err=' + err + ') in database');
					return callback({ title: 'Adding user failed', message: 'Could not access database.' }, null);
				}
				// check if this is a verified user
				var verified = email == app.config['email-address'] ? 1 : 0;
				// add user to database
				// note: in principle it is possible that the same token is generated by two concurrent requests,
				//       but we assume this is very unlikely to happen
				database.db.run('INSERT INTO users VALUES (?,?,?,?)', [name, email, token, verified], function (err) {
					if (err) {
						app.logger.debug('could not add user (name=' + name + ', email=' + email + ', token=' + token + ', err=' + err + ') to database');
						return callback({ title: 'Adding user failed', message: 'Could not access database.' }, null);
					}
					app.logger.debug('added user (name=' + name + ', email=' + email + ', token=' + token + ') to database');
					return callback(null, { title: 'Adding user succeeded', message: 'Your token is "' + token + '". Please make sure to write it down. We have also emailed it to ' + email + '.', token: token });
				});
			});
		});
	},
	
	// update an existing user
	updateUser: function(name, email, token, callback) {
		// validate details
		// note: we allow a name with a length between 1 and 24 characters containing only
		//       alphanumeric characters plus the dash and underscore
		var re1 = /^[A-Za-z0-9-_]{1,24}$/;
		if (!re1.test(name)) {
			app.logger.debug('name has an invalid format (name=' + name + ', email=' + email + ', token=' + token + ')');
			return callback({ title: 'Updating user failed', message: 'Name has an invalid format.' }, null);
		}
		var re2 = /^([\w-]+(?:\.[\w-]+)*)@((?:[\w-]+\.)*\w[\w-]{0,66})\.([a-z]{2,6}(?:\.[a-z]{2})?)$/i;
		if (!re2.test(email)) {
			app.logger.debug('email has an invalid format (name=' + name + ', email=' + email + ', token=' + token + ')');
			return callback({ title: 'Updating user failed', message: 'Email address has an invalid format.' }, null);
		}	
		// check if the name already exists
		database.db.get('SELECT COUNT(*) AS count FROM users WHERE LOWER(name)=?', name.toLowerCase(), function (err, ret) {
			if (err) {
				app.logger.debug('could not check user (name=' + name + ', email=' + email + ', token=' + token + ', err=' + err + ') in database');
				return callback({ title: 'Adding user failed', message: 'Could not access database.' }, null);
			}
			if (ret.count != 0) {
				app.logger.debug('name is already registered (name=' + name + ', email=' + email + ') in database');
				return callback({ title: 'Updating user failed', message: 'Name is already registered.' }, null);
			}
			// update the user
			database.db.run('UPDATE users SET name=?, email=? WHERE token=?', [name, email, token], function (err) {
				if (err) {
					app.logger.debug('could not update user (name=' + name + ', email=' + email + ', token=' + token + ', err=' + err + ') in database');
					return callback({ title: 'Updating user failed', message: 'Could not access database.' }, null);
				}
				if (this.changes == 0) {
					app.logger.debug('no user found (name=' + name + ', email=' + email + ', token=' + token + ') in database');
					return callback({ title: 'Updating user failed', message: 'No user found with specified details.' }, null);
				}
				app.logger.debug('updated user (name=' + name + ', email=' + email + ', token=' + token + ') in database');
				return callback(null, { title: 'Updating user succeeded', message: 'Your registration has been updated.' });
			});
		});
	},
	
	// remove an existing user
	removeUser: function(name, email, token, callback) {
		// remove the user
		database.db.run('DELETE FROM users WHERE LOWER(name)=? AND LOWER(email)=? AND token=?', [name.toLowerCase(), email.toLowerCase(), token], function (err) {
			if (err) {
				app.logger.debug('could not remove user (name=' + name + ', email=' + email + ', token=' + token + ', err=' + err + ') from database');
				return callback({ title: 'Removing user failed', message: 'Could not access database.' }, null);
			}
			if (this.changes == 0) {
				app.logger.debug('no user found (name=' + name + ', email=' + email + ', token=' + token + ') in database');
				return callback({ title: 'Removing user failed', message: 'No user found with specified details.' }, null);
			}
			app.logger.debug('removed user (name=' + name + ', email=' + email + ', token=' + token + ') from database');
			return callback(null, { title: 'Removing user succeeded', message: 'Your registration has been removed.' });
		});
	},
	
	// generate a unique token
	generateToken: function(callback) {
		var token = randtoken.generate(24);
		database.db.get('SELECT COUNT(*) AS count FROM users WHERE token=?', token, function (err, ret) {
			if (err)
				return callback(err, null);
			// recursively call this function until we find a valid token
			if (ret.count != 0)
				return generateToken(callback);
			return callback(null, token);
		});
	},
	
	// check if token exists
	existsToken: function(token, callback) {
		database.db.get('SELECT COUNT(*) AS count FROM users WHERE token=?', token, function (err, ret) {
			if (err) {
				app.logger.debug('could not check token (token=' + token + ', err=' + err + ') in database');
				return callback({ title: 'Token check failed', message: 'Could not access database.' }, null);
			}
			if (ret.count == 0) {
				app.logger.debug('no user found (token=' + token + ') in database');
				return callback({ title: 'Token check failed', message: 'No user found with specified token.' }, null);
			}
			return callback(null, { title: 'Token check succeeded', message: 'Your registration was found' });
		});
	},
	
	// check the timestamp associated with the last run and compare it with the provided timestamp
	checkTimestamp: function(token, timestamp, subtask, callback) {
		database.db.get('SELECT MAX(timestamp) AS timestamp FROM runs WHERE token=? AND subtask=? AND (state=0 OR state=1)', [token, subtask], function (err, ret) {
			if (err) {
				app.logger.debug('could not check timestamp (token=' + token + ', err=' + err + ') in database');
				return callback({ title: 'Timestamp check failed', message: 'Could not access database.' }, null);
			}
			var last = ret.timestamp == null ? 0 : ret.timestamp;
			var wait = Number(app.config['upload-delay-ms']);
			if (Math.abs(timestamp - last) < wait) {
				app.logger.debug('timestamp too recent (token=' + token + ', timestamp=' + timestamp + ', last=' + last + ') in database');
				return callback({ title: 'Timestamp check failed', message: 'You have to wait at least ' + (wait / (1000 * 60)) + ' minutes between successive submissions.' }, null);
			}
			app.logger.debug('checked timestamp (token=' + token + ', timestamp=' + timestamp + ', last=' + last + ') in database');
			return callback(null, { title: 'Timestamp check succeeded', message: 'You may submit a run.' });
		});
	},
	
	// get user details
	getUser: function(token, callback) {
		database.db.get('SELECT name, email FROM users WHERE token=?', token, function (err, ret) {
			if (err) {
				app.logger.debug('could not get user details (token=' + token + ', err=' + err + ') from database');
				return callback({ title: 'Getting user details failed', message: 'Could not access database.' }, null);
			}
			app.logger.debug('checked user (token=' + token + ', name=' + ret.name + ', email=' + ret.email + ') in database');
			return callback(null, { title: 'Getting user details succeeded', message: 'The user ' + ret.name + ' with email address ' + ret.email + ' is associated with token ' + token + '.', name: ret.name, email: ret.email });
		});
	},

	// add a run
	addRun: function(token, timestamp, subtask, comment, callback) {
		// delete all previous runs by this user for this subtask that are not in a valid state
		database.db.run('DELETE FROM runs WHERE token=? AND subtask=? AND state<=0', [token, subtask], function (err) {
			if (err) {
				app.logger.debug('could not add run (token=' + token + ', timestamp=' + timestamp + ', state=' + state + ', subtask=' + subtask + ', score1=' + score1 + ', score2=' + score2 + ', score3=' + score3 + ', comment=' + comment + ', err=' + err + ') to database');
				return callback({ title: 'Adding run failed', message: 'Could not access database.' }, null);
			}
			// insert run
			// note: set the state to processing (=0) and add a placeholder (=null) for the score fields
			var state = 0;
			var score1 = null;
			var score2 = null;
			var score3 = null;
			database.db.run('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)', [token, timestamp, state, subtask, score1, score2, score3, comment, Date.now()], function (err) {
				if (err) {
					app.logger.debug('could not add run (token=' + token + ', timestamp=' + timestamp + ', state=' + state + ', subtask=' + subtask + ', score1=' + score1 + ', score2=' + score2 + ', score3=' + score3 + ', comment=' + comment + ', err=' + err + ') to database');
					return callback({ title: 'Adding run failed', message: 'Could not access database.' }, null);
				}
			});
			app.logger.debug('added run (token=' + token + ', timestamp=' + timestamp + ', state=' + state + ', subtask=' + subtask + ', score1=' + score1 + ', score2=' + score2 + ', score3=' + score3 + ', comment=' + comment + ') to database');
			return callback(null, { title: 'Adding run succeeded', message: 'Your run has been added.' });
		});
	},
	
	// update a run
	updateRun: function(token, timestamp, state, subtask, score1, score2, score3, comment, callback) {
		// mark the run as valid and set the scores
		database.db.run('UPDATE runs SET state=?, score1=?, score2=?, score3=?, comment=?, lastmodified=? WHERE token=? AND timestamp=? AND subtask=?', [state, score1, score2, score3, comment, Date.now(), token, timestamp, subtask], function (err, ret) {
			if (err) {
				app.logger.debug('could not update run (token=' + token + ', timestamp=' + timestamp + ', state=' + state + ', subtask=' + subtask + ', score1=' + score1 + ', score2=' + score2 + ', score3=' + score3 + ', comment=' + comment + ', err=' + err + ') in database');
				return callback({ title: 'Updating run failed', message: 'Could not access database.' }, null);
			}
			if (this.changes == 0) {
				app.logger.debug('could not update run (token=' + token + ', timestamp=' + timestamp + ', state=' + state + ', subtask=' + subtask + ', score1=' + score1 + ', score2=' + score2 + ', score3=' + score3 + ', comment=' + comment + ', err=' + err + ') in database');
				return callback({ title: 'Updating run failed', message: 'No run found with specified details.' }, null);
			}
			app.logger.debug('updated run (token=' + token + ', timestamp=' + timestamp + ', state=' + state + ', subtask=' + subtask + ', score1=' + score1 + ', score2=' + score2 + ', score3=' + score3 + ', comment=' + comment + ') in database');
			return callback(null, { title: 'Updating run succeeded', message: 'Your run was updated.' });
		});
	},
	
	// remove an existing run
	removeRun: function(token, timestamp, callback) {
		// remove the run
		database.db.run('DELETE FROM runs WHERE token=? AND timestamp=?', [token, timestamp], function (err) {
			if (err) {
				app.logger.debug('could not delete run (token=' + token + ', timestamp=' + timestamp + ', err=' + err + ') from database');
				return callback({ title: 'Removing run failed', message: 'Could not access database.' }, null);
			}
			if (this.changes == 0) {
				app.logger.debug('no run found (token=' + token + ', timestamp=' + timestamp + ') in database');
				return callback({ title: 'Removing run failed', message: 'No run found with specified details.' }, null);
			}
			app.logger.debug('removed run (token=' + token + ', timestamp=' + timestamp + ') from database');
			return callback(null, { title: 'Removing run succeeded', message: 'Your run has been removed.' });
		});
	},
	
	// get leaderboard
	getLeaderboard: function(subtask, sort, limit, callback) {
		// validate parameters
		if (subtask != 'tag' && subtask != 'caption')
			return callback({ title: 'Getting leaderboard failed', message: 'Invalid subtask requested (supported are "tag" and "caption")' }, null);
		if (limit <= 0)
			return callback({ title: 'Getting leaderboard failed', message: 'Invalid limit requested (supported are values larger than zero)' }, null);
		if (sort != 'ASC' && sort != 'DESC')
			return callback({ title: 'Getting leaderboard failed', message: 'Invalid sort requested (supported are "ASC" and "DESC")' }, null);
		// get the top run per user
		// note: select the run with the best score. we use the score1 field for ranking.
		var op = sort == 'ASC' ? 'MIN' : 'MAX';
		database.db.all('SELECT verified, name, DATETIME(timestamp / 1000, "unixepoch", "localtime") AS timestamp, state, ' + op + '(score1) AS score1, score2, score3, comment FROM users NATURAL LEFT OUTER JOIN runs WHERE subtask=? AND state>0 GROUP BY token ORDER BY score1 ' + sort + ' LIMIT ?', [subtask, limit], function (err, ret) {
			if (err) {
				app.logger.debug('could not get leaderboard (err=' + err + ') from database');
				return callback({ title: 'Getting leaderboard failed', message: 'Could not access database.' }, null);
			}
			var valid = ret;
			// get the latest run per user that is still processing
			database.db.all('SELECT verified, name, DATETIME(MAX(timestamp) / 1000, "unixepoch", "localtime") AS timestamp, state, comment FROM users NATURAL LEFT OUTER JOIN runs WHERE subtask=? AND state=0 GROUP BY token ORDER BY timestamp DESC', [subtask], function (err, ret) {
				if (err) {
					app.logger.debug('could not get leaderboard (err=' + err + ') from database');
					return callback({ title: 'Getting leaderboard failed', message: 'Could not access database.' }, null);
				}
				var active = ret;
				// get the latest run per user that has an error
				database.db.all('SELECT verified, name, DATETIME(MAX(timestamp) / 1000, "unixepoch", "localtime") AS timestamp, state, comment FROM users NATURAL LEFT OUTER JOIN runs WHERE subtask=? AND state<0 GROUP BY token ORDER BY timestamp DESC', [subtask], function (err, ret) {
					if (err) {
						app.logger.debug('could not get leaderboard (err=' + err + ') from database');
						return callback({ title: 'Getting leaderboard failed', message: 'Could not access database.' }, null);
					}
					var invalid = ret;
					// return the results
					return callback(null, { title: 'Getting leaderboard succeeded', message: '', valid: valid, active: active, invalid: invalid});
				});
			});
		});
	},
		
	// perform regular actions according to a schedule
	timer: null,
	maintenance: function() {
		// delete all stale runs that are not in a valid state
		var timestamp = Date.now() - app.config['timer-clean-ms'];
		database.db.run('DELETE FROM runs WHERE lastmodified<=? AND state<=0', timestamp, function (err) {
			if (err) {
				app.logger.debug('could not delete runs (err=' + err + ') from database');
				return;
			}
			app.logger.debug('a total of ' + this.changes + (this.changes == 1 ? ' stale run was ' : ' stale runs were ') + 'removed from the database');
			// print out all remaining runs
			database.db.all('SELECT name, email, token, DATETIME(timestamp / 1000, "unixepoch", "localtime") AS timestamp, state, subtask, score1, score2, score3, comment FROM users NATURAL LEFT OUTER JOIN runs ORDER BY name ASC, timestamp DESC', [], function (err, ret) {
				if (err) {
					app.logger.debug('could not get statistics (err=' + err + ') from database');
					return;
				}
				app.logger.debug('a total of ' + ret.length + (ret.length == 1 ? ' run remains ' : ' runs remain ') + 'in the database');
				for (var i = 0; i < ret.length; i++)
					app.logger.debug('  entry ' + i + ': name=' + ret[i].name + ', email=' + ret[i].email + ', token=' + ret[i].token + ', timestamp=' + ret[i].timestamp + ', state=' + ret[i].state + ', subtask=' + ret[i].subtask + ', score1=' + ret[i].score1 + ', score2=' + ret[i].score2 + ', score3=' + ret[i].score3 + ', comment=' + ret[i].comment + ')');
			});
		});
	},
};

// perform regular actions according to a schedule
database.timer = setInterval(database.maintenance, app.config['timer-delay-ms']);

// shutdown handler
shutdown.addHandler('database', 10, function(callback) {
	// cancel the timer
	if (database.timer != null) {
		clearInterval(database.timer);
		database.timer = null;
	}
	// close the database
	database.db.close();
	// call the callback to signal we completed the cleanup
	callback();
});

// export the module
module.exports = database;