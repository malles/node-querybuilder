/**
 * MySQL ActiveRecord Adapter for Node.js
 * (C) Martin Tajur 2011-2013
 * martin@tajur.ee
 * 
 * Active Record Database Pattern implementation for use with node-mysql as MySQL connection driver.
 * 
 * Dual licensed under the MIT and GPL licenses.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL KEVIN VAN ZONNEVELD BE LIABLE FOR ANY CLAIM, DAMAGES
 * OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 * 
**/ 

var Adapter = function(settings) {

	var mysql = require('mysql');

	var initializeConnectionSettings = function () {
		if(settings.server) {
			settings.host = settings.server;
		}
		if(settings.username) {
			settings.user = settings.username;
		}

		if (!settings.host) {
			throw new Error('Unable to start ActiveRecord - no server given.');
		}
		if (!settings.port) {
			settings.port = 3306;
		}
		if (!settings.user) {
			settings.user = '';
		}
		if (!settings.password) {
			settings.password = '';
		}
		if (!settings.database) {
			throw new Error('Unable to start ActiveRecord - no database given.');
		}

		return settings;
	};

	var connection;
	var connectionSettings;
	var pool;

	if (settings && settings.pool) {
		pool = settings.pool.pool;
		connection = settings.pool.connection;
	} else {
		connectionSettings = initializeConnectionSettings();
		connection = new mysql.createConnection(connectionSettings);
	}

	if (settings.charset) {
		connection.query('SET NAMES ' + settings.charset);
	}
	
	var whereArray = [],
		whereInArray = [],
		fromArray = [],
		joinArray = [],
		selectArray = [],
		orderByClause = '',
		groupByClause = '',
		havingClause = '',
		limitClause = -1,
		offsetClause = -1,
		joinClause = [],
		lastQuery = '',
		distinctClause = '',
		aliasedTables = []
	
	var resetQuery = function(newLastQuery) {
		whereArray = [];
		whereInArray = [];
		fromArray = [];
		joinArray = [];
		selectArray = [];
		orderByClause = '';
		groupByClause = '';
		havingClause = '',
		limitClause = -1;
		offsetClause = -1;
		joinClause = [];
		distinctClause = '';
		lastQuery = (typeof newLastQuery === 'string' ? newLastQuery : '');
		aliasedTables = [];
	};
	
	var trackAliases = function(table) {
		if (Object.prototype.toString.call(table) === Object.prototype.toString.call({})) {
			for (var i in table) {
				var t = table[i];
				trackAliases(t);
			}
			return;
		}

		// Does the string contain a comma?  If so, we need to separate
		// the string into discreet statements
		if (table.indexOf(',') !== -1) {
			return trackAliases(table.split(','));
		}

		// if a table alias is used we can recognize it by a space
		if (table.indexOf(' ') !== -1) {
			// if the alias is written with the AS keyword, remove it
			table = table.replace(/\s+AS\s+/gi, ' ');
			
			// Grab the alias
			alias = table.slice(table.lastIndexOf(' ')).trim();

			// Store the alias, if it doesn't already exist
			if(aliasedTables.indexOf(table) == -1) {
				aliasedTables.push(table);
			}
		}
	}
	
	var escapeIdentifiers = function(item) {
		if (!item || item === '*') {
			return item;
		}
		
		var str;
		if (item.indexOf('.') !== -1) {
			str = '`' + item.replace(/\./g,'`.`') + '`';
		}
		else {
			str = '`' + item + '`';
		}
		
		// remove duplicates if the user already included the escape
		return str.replace(/[`]+/,'`');
	}
	
	var protectIdentifiers = function(item,protect_identifiers) {
		protect_identifiers = (typeof protect_identifiers === 'boolean' ? protect_identifiers : true);
		
		if(Object.prototype.toString.call(item) === Object.prototype.toString.call({})) {
			var escaped_array = {};

			for (k in item) {
				var v = item[k];
				escaped_array[protectIdentifiers(k)] = protectIdentifiers(v);
			}

			return escaped_array;
		}
		
		// Convert tabs or multiple spaces into single spaces
		item = item.replace(/\s+/g, ' ');
		
		// If the item has an alias declaration we remove it and set it aside.
		// Basically we remove everything to the right of the first space
		if (item.match(/\sAS\s/ig)) {
			var alias_index = item.indexOf(item.match(/\sAS\s/ig)[0]);
			var alias = (protect_identifiers ? item.substr(alias_index,4) + escapeIdentifiers(item.slice(alias_index + 4)) : item.substr(alias_index));
			item = item.substr(0,alias_index);
		}
		else if (item.indexOf(' ') !== -1) {
			var alias_index = item.indexOf(' ');
			
			var alias = (protect_identifiers && ! hasOperator(item.substr(alias_index + 1)) ? ' ' + escapeIdentifiers(item.substr(alias_index + 1)) : item.substr(alias_index));
			item = item.substr(0,alias_index);
		}
		else {
			alias = '';
		}
		
		// This is basically a bug fix for queries that use MAX, MIN, etc.
		// If a parenthesis is found we know that we do not need to
		// escape the data or add a prefix.
		if (item.indexOf('(') !== -1 || item.indexOf("'") !== -1) {
			return item;
		}
		
		// Break the string apart if it contains periods, then insert the table prefix
		// in the correct location, assuming the period doesn't indicate that we're dealing
		// with an alias. While we're at it, we will escape the components
		if (item.indexOf('.') !== -1) {
			parts	= item.split('.');

			// Does the first segment of the exploded item match
			// one of the aliases previously identified?  If so,
			// we have nothing more to do other than escape the item
			if (aliasedTables.indexOf(parts[0]) !== -1) {
				if (protect_identifiers === true) {
					for (var key in parts) {
						var val = parts[key];
						if (val !== '*') {
							parts[key] = escapeIdentifiers(val);
						}
					}

					item = parts.join('.');
				}
				return item + alias;
			}

			if (protect_identifiers === true) {
				item = escapeIdentifiers(item);
			}

			return item + alias;
		}
		if (protect_identifiers === true) {
			item = escapeIdentifiers(item);
		}
		
		return item + alias;
	};
	
	var buildWhereClause = function() {
		var sql = '';
		if(whereArray.length > 0) {
			sql += " WHERE ";
		}
		sql += whereArray.join(" ");
		return sql;
	}
	
	var buildFromClause = function() {
		var sql = '';
		if(fromArray.length > 0) {
			sql += " FROM ";
		}
		sql += '(' + fromArray.join(', ') + ')';
		return sql;
	};
	
	var buildDataString = function(dataSet, separator, clause) {
		clause = clause || 'SET';
		separator = separator || ', ';
		
		var queryString = '', y = 1;
		var useSeparator = true;
		
		var datasetSize = getObjectSize(dataSet);
		
		for (var key in dataSet) {
			useSeparator = true;
			
			if (dataSet.hasOwnProperty(key)) {
				if (dataSet[key] === null) {
					queryString += protectIdentifiers(key) + "=NULL";
				}
				else if (typeof dataSet[key] !== 'object') {
					queryString += protectIdentifiers(key) + "=" + connection.escape(dataSet[key]);
				}
				else {
					useSeparator = false;
					datasetSize = datasetSize - 1;
				}
				
				if (y < datasetSize && useSeparator) {
					queryString += separator;
					y++;
				}
			}
		}
		if (getObjectSize(dataSet) > 0) {
			queryString = ' ' + clause + ' ' + queryString;
		}
		return queryString;
	};
	
	var buildJoinString = function() {
		var sql = '';
		sql += joinArray.join(' ');
		if(sql.length > 0) sql = ' ' + sql;
		return sql;
	};
	
	var mergeObjects = function() {
		for (var i = 1; i < arguments.length; i++) {
			for (var key in arguments[i]) {
				if (arguments[i].hasOwnProperty(key)) {
					arguments[0][key] = arguments[i][key];
				}
			}
		}
		return arguments[0];
	};
	
	var getObjectSize = function(object) {
		var size = 0;
		for (var key in object) {
			if (object.hasOwnProperty(key)) {
				size++;
			}
		}
		return size;
	};
	
	var trim = function (s) {
		var l = 0, r = s.length - 1;
		while (l < s.length && s[l] == ' ') {
			l++;
		}
		while (r > l && s[r] == ' ') {
			r-=1;
		}
		return s.substring(l, r + 1);
	};
	
	var hasOperator = function (str) {
		if(typeof str === 'string') {
			if(!str.trim().match(/(<|>|!|=|\sIS NULL|\sIS NOT NULL|\sEXISTS|\sBETWEEN|\sLIKE|\sIN\s*\(|\s)/gi)) {
				return false;
			}
		}
		return true;
	}
	
	var qb_escape = function(str) {
		if (typeof str === 'string') {
			str = "'" + this.escape(str) + "'";
		}
		else if (typeof str === 'boolean') {
			str = (str === false ? 0 : 1);
		}
		else if (str === null) {
			str = 'NULL';
		}

		return str;
	}
	
	var compileSelect = function() {
		var sql = 'SELECT ' + distinctClause;
		if (selectArray.length === 0) {
			sql += '*';
		}
		
		sql += selectArray.join(', ')
			+ buildFromClause()
			+ buildJoinString()
			+ buildWhereClause()
			+ (groupByClause !== '' ? ' GROUP BY ' + groupByClause : '')
			+ (havingClause !== '' ? ' HAVING ' + havingClause : '')
			+ (orderByClause !== '' ? ' ORDER BY ' + orderByClause : '')
			+ (limitClause !== -1 ? ' LIMIT ' + limitClause : '')
			+ (offsetClause !== -1 ? ' OFFSET ' + offsetClause : '');
		
		return sql;
	}
	
	var createAliasFromTable = function(item) {
		if (item.indexOf('.') !== -1) {
			return item.split('.').reverse()[0];
		}

		return item;
	};
	
	this.connectionSettings = function() { return connectionSettings; };
	this.connection = function() { return connection; };
	
	this.where = function(key, value, isRaw) {
		isRaw = (typeof isRaw === 'boolean' ? isRaw : false);
		value = value || null;
		
		var escape = (isRaw ? false : true);
		if (typeof key === 'string' && typeof value === 'object' && Object.prototype.toString.call(value) === Object.prototype.toString.call([]) && value.length > 0) {
			return this._where_in(key, value, false, 'AND ');
		}
		return this._where(key, value, 'AND ', escape);
	};
	
	this.or_where = function(key, value, isRaw) {
		isRaw = (typeof isRaw === 'boolean' ? isRaw : false);
		value = value || null;
		
		var escape = (isRaw ? false : true);
		if (typeof key === 'string' && typeof value === 'object' && Object.prototype.toString.call(value) === Object.prototype.toString.call([]) && value.length > 0) {
			return this._where_in(key, value, false, 'OR ');
		}
		return this._where(key, value, 'OR ', escape);
	};
	
	this.where_in = function(key, values) {
		return this._where_in(key,values,false,'AND ');
	}
	
	this.or_where_in = function(key, values) {
		return this._where_in(key,values,false,'OR ');
	}
	
	this.where_not_in = function(key, values) {
		return this._where_in(key,values,true,'AND ');
	}
	
	this.or_where_not_in = function(key, values) {
		return this._where_in(key,values,true,'OR ');
	}
	
	this._where = function(key, value, type, escape) {
		value = value || null;
		type = type || 'AND ';
		escape = (typeof escape === 'boolean' ? escape : true);
		
		if (Object.prototype.toString.call(key) !== Object.prototype.toString.call({})) {
			key_array = {};
			key_array[key] = value;
			key = key_array;
		}
		
		for (var k in key) {
			var v = key[k];
			
			if (typeof v === 'object' && Object.prototype.toString.call(v) === Object.prototype.toString.call([]) && v.length > 0) {
				return this._where_in(k,v,false,type);
			}
			
			var prefix = (whereArray.length == 0 ? '' : type);
			
			if (v === null && !hasOperator(k)) {
				k += ' IS NULL';
			}
			
			if (v !== null) {
				if (escape === true) {
					k = protectIdentifiers(k);
					v = ' ' + qb_escape(v);
				}
				
				if (!hasOperator(k)) {
					k += ' =';
				}
			}
			else {
				k = protectIdentifiers(k);
			}
			
			if (v) {
				whereArray.push(prefix+k+v);
			} 
			else {
				whereArray.push(prefix+k);
			}
		}
		
		return that;
	};
	
	this._where_in = function(key, values, not, type) {
		key = key || null;
		values = values || [];
		type = type || 'AND ';
		not = (not ? ' NOT' : '');
		
		if(key === null || values.length === 0) return that;
		
		// Values must be an array...
		if(Object.prototype.toString.call(value) !== Object.prototype.toString.call([])) {
			values = [values];
		}
		
		for (var i in values) {
			var value = values[i];
			whereInArray.push(qb_escape(value));
		}

		prefix = (whereArray.length == 0 ? '' : type);

		where_in = prefix + protectIdentifiers(key) + not + " IN (" + whereInArray.join(', ') + ") ";

		whereArray.push(where_in);

		// reset the array for multiple calls
		whereInArray = [];
		return that;
	};
	
	this.like = function(field, match, side) {
		match = match || '';
		side = side || 'both';
		
		return this._like(field, match, 'AND ', side, '');
	};
	
	this.not_like = function(field, match, side) {
		match = match || '';
		side = side || 'both';
		
		return this._like(field, match, 'AND ', side, ' NOT');
	};
	
	this.or_like = function(field, match, side) {
		match = match || '';
		side = side || 'both';
		
		return this._like(field, match, 'OR ', side, '');
	};
	
	this.or_not_like = function(field, match, side) {
		match = match || '';
		side = side || 'both';
		
		return this._like(field, match, 'OR ', side, ' NOT');
	};
	
	this._like = function(field, match, type, side, not) {
		match = match || '';
		type = type || 'AND ';
		side = side || 'both';
		not = not || '';
	
		if(Object.prototype.toString.call(field) !== Object.prototype.toString.call({})) {
			field_array = {};
			field_array[field] = match;
			field = field_array;
		}

		for(k in field) {
			v = field[k];
			k = protectIdentifiers(k.trim());

			if (side === 'none') {
				like_statement =  k + not + ' LIKE ' + "'" + v + "'";
			} 
			else if (side === 'before') {
				like_statement = k + not + ' LIKE ' + "'%" + v + "'";
			} 
			else if (side === 'after') {
				like_statement = k + not + ' LIKE ' + "'" + v + "%'";
			} 
			else {
				like_statement = k + not + ' LIKE ' + "'%" + v + "%'";
			}
			
			this._where(like_statement,null,type,false);
		}

		return that;
	};
	
	this.count = function(table, responseCallback) {
		if (typeof table === 'string') {
			trackAliases(table);
			this.from(table);
		}
		var sql = this.query('SELECT COUNT(*) AS ' + protectIdentifiers('count')
			+ buildFromClause()
			+ buildJoinString()
			+ buildWhereClause());
			
		connection.query(sql, function(err, res) { 
			if (err)
				responseCallback(err, null);
			else
				responseCallback(null, res[0]['count']);
		});
		resetQuery(sql);
		
		return that;
	};
	
	this.from = function(from) {
		if(Object.prototype.toString.call(from) !== Object.prototype.toString.call([])) {
			from = [from];
		}
		for (var i in from) {
			var val = from[i];
			
			if (val.indexOf(',') !== -1) {
				var objects = val.split(',');
				for (var j in objects) {
					var v = objects[j].trim();
					
					trackAliases(v);

					fromArray.push(protectIdentifiers(v, true));
				}
			}
			else {
				val = val.trim();

				// Extract any aliases that might exist.  We use this information
				// in the protectIdentifiers function to know whether to add a table prefix
				trackAliases(val);

				fromArray.push(protectIdentifiers(val, true));
			}
		}

		return that;
	}

	this.join = function(tableName, relation, direction) {
		direction = (!direction || typeof direction !== 'string' ? '' : direction);
		
		var valid_directions = ['LEFT','RIGHT','OUTER','INNER','LEFT OUTER','RIGHT OUTER'];
		
		if (direction != '') {
			direction = direction.toUpperCase();
			if (valid_directions.indexOf(direction) === -1) {
				direction = '';
			}
			else {
				direction += ' ';
			}
		}
		
		trackAliases(tableName);
		
		var match;
		if (match = relation.match(/([\w\.]+)([\W\s]+)(.+)/)) {
			match[1] = protectIdentifiers(match[1]);
			match[3] = protectIdentifiers(match[3]);
			
			relation = match[1] + match[2] + match[3];
		}
		
		join = direction + 'JOIN ' + protectIdentifiers(tableName, true) + ' ON ' + relation;
		
		joinArray.push(join);
		return that;
	};
	
	this.select = function(select,escape) {
		if (typeof escape !== 'boolean') escape = true;
		
		if (typeof select === 'string') {
			select = select.split(',');
		}
		
		for (var i in select) {
			var val = select[i].trim();
			
			if(val !== '') {
				selectArray.push(protectIdentifiers(val));
			}
		}
		return that;
	};
	
	this.select_min = function(select,alias) {
		return this._min_max_avg_sum(select,alias,'MIN');
	};
	
	this.select_max = function(select,alias) {
		return this._min_max_avg_sum(select,alias,'MAX');
	};
	
	this.select_avg = function(select,alias) {
		return this._min_max_avg_sum(select,alias,'AVG');
	};
	
	this.select_sum = function(select,alias) {
		return this._min_max_avg_sum(select,alias,'SUM');
	};
	
	this._min_max_avg_sum = function(select,alias,type) {
		select = select || '';
		alias = alias || '';
		type = type || 'MAX';
		
		if (typeof select !== 'string' || select === '') {
			throw Error("Invalid query!");
			return that;
		}
		
		type = type.toUpperCase();
		
		if (['MAX','MIN','AVG','SUM'].indexOf(type) === -1) {
			throw Error("Invalid function type!");
			return that;
		}
		
		if (alias == '') {
			alias = createAliasFromTable(select.trim());
		}
		
		sql = type + '(' + protectIdentifiers(select.trim()) + ') AS ' + alias;
		
		selectArray.push(sql);
		
		return that;
	}
	
	this.distinct = function() {
		distinctClause = 'DISTINCT ';
		return that;
	};

	this.comma_separated_arguments = function(set) {
		var clause = '';
		if (Object.prototype.toString.call(set) === '[object Array]') {
			clause = set.join(', ');
		}
		else if (typeof set === 'string') {
			clause = set;
		}
		return clause;
	};

	this.group_by = function(set) {
		groupByClause = this.comma_separated_arguments(set);
		return that;
	};

	this.having = function(set) {
		havingClause = this.comma_separated_arguments(set);
		return that;
	};

	this.order_by = function(set) {
		orderByClause = this.comma_separated_arguments(set);
		return that;
	};
	
	this.limit = function(newLimit, newOffset) {
		if (typeof newLimit === 'number') {
			limitClause = newLimit;
		}
		if (typeof newOffset === 'number') {
			offsetClause = newOffset;
		}
		return that;
	};

	this.ping = function() {
		connection.ping();
		return that;
	};
	
	this.insert = function(tableName, dataSet, responseCallback, verb, querySuffix) {
		if (typeof verb === 'undefined') {
			var verb = 'INSERT';
		}
		if (Object.prototype.toString.call(dataSet) !== '[object Array]') {
			if (typeof querySuffix === 'undefined') {
				var querySuffix = '';
			}
			else if (typeof querySuffix !== 'string') {
				var querySuffix = '';
			}
			if (typeof tableName === 'string') {
				
				var combinedQueryString = verb + ' into ' + protectIdentifiers(tableName)
				+ buildDataString(dataSet, ', ', 'SET');
				
				if (querySuffix != '') {
					combinedQueryString = combinedQueryString + ' ' + querySuffix;
				}
				
				connection.query(combinedQueryString, responseCallback);
				resetQuery(combinedQueryString);
			}
		}
		else {
			doBatchInsert(verb, tableName, dataSet, responseCallback);
		}
		return that;
	};
	
	this.insert_ignore = function(tableName, dataSet, responseCallback, querySuffix) {
		return this.insert(tableName, dataSet, responseCallback, 'INSERT IGNORE', querySuffix);
	};

	var doBatchInsert = function(verb, tableName, dataSet, responseCallback) {
		if (Object.prototype.toString.call(dataSet) !== '[object Array]') {
			throw new Error('Array of objects must be provided for batch insert!');
		}
		
		if (dataSet.length == 0) return false;

		var map = [];
		var columns = [];

		for (var key in dataSet[0]) {
			if (dataSet[0].hasOwnProperty(key)) {
				if (columns.indexOf(key) == -1) {
					columns.push(protectIdentifiers(key));
				}
			}
		}

		for (var i = 0; i < dataSet.length; i++) {
			(function(i) {
				var row = [];
				for (var key in dataSet[i]) {
					if (dataSet[i].hasOwnProperty(key)) {
						row.push(that.escape(dataSet[i][key]));
					}
				}
				if (row.length != columns.length) {
					throw new Error('Cannot use batch insert into ' + tableName + ' - fields must match on all rows (' + row.join(',') + ' vs ' + columns.join(',') + ').');
				}
				map.push('(' + row.join(',') + ')');
			})(i);
		}

		that.query(verb + ' INTO ' + protectIdentifiers(tableName) + ' (' + columns.join(', ') + ') VALUES' + map.join(','), responseCallback);
		return that;
	};

	this.get = function(table, callback) {
		if (typeof table !== 'function') {
			trackAliases(table);
			this.from(table);
		}
		else {
			if (fromArray.length == 0) {
				throw new Error('You have not specified any tables to select from!');
				return that;
			}
			else {
				callback = table;
			}
		}
	
		var sql = compileSelect();
		
		connection.query(sql, callback);
		resetQuery(sql);
		
		return that;
	};
	
	this.get_where = function(table, where, callback) {
		if (table !== '') {
			this.from(table);
		}
		
		if (where !== null) {
			this.where(where);
		}
		
		var sql = compileSelect();
		
		connection.query(sql, callback);
		resetQuery(sql);
		
		return that;
	};
	
	this.update = function(tableName, newData, responseCallback) {
		if (typeof tableName === 'string') {
			var combinedQueryString = 'UPDATE ' + protectIdentifiers(tableName)
			+ buildDataString(newData, ', ', 'SET')
			+ buildWhereClause()
			+ (limitClause !== -1 ? ' LIMIT ' + limitClause : '');
						
			connection.query(combinedQueryString, responseCallback);
			resetQuery(combinedQueryString);
		}
		
		return that;
	};
	
	this.escape = function(str) {
		return connection.escape(str);
	};
	
	this.delete = function(tableName, responseCallback) {
		if (typeof tableName !== 'function') {
			trackAliases(tableName);
			this.from(tableName);
		}
		else {
			if (fromArray.length == 0) {
				throw new Error('You have not specified any tables to delete from!');
				return that;
			}
			else {
				responseCallback = tableName;
			}
		}
		
		var combinedQueryString = 'DELETE'
		+ buildFromClause()
		+ buildWhereClause()
		+ (limitClause !== -1 ? ' LIMIT ' + limitClause : '');
		
		connection.query(combinedQueryString, responseCallback);
		resetQuery(combinedQueryString);
		
		return that;
	};
	
	this._last_query = function() {
		return lastQuery;
	};
	
	this.query = function(sqlQueryString, responseCallback) {
		connection.query(sqlQueryString, responseCallback);
		resetQuery(sqlQueryString);
		return that;
	};
	
	this.disconnect = function() {
		return connection.end();
	};

	this.forceDisconnect = function() {
		return connection.destroy();
	};
	
	this.releaseConnection = function() {
		pool.releaseConnection(connection);
	};

	this.releaseConnection = function() {
		pool.releaseConnection(connection);
	};

	var reconnectingTimeout = false;

	function handleDisconnect(connectionInstance) {
		connectionInstance.on('error', function(err) {
			if (!err.fatal || reconnectingTimeout) {
				return;
			}

			if (err.code !== 'PROTOCOL_CONNECTION_LOST' && err.code !== 'ECONNREFUSED') {
				throw err;
			}

			var reconnectingTimeout = setTimeout(function() {
				connection = mysql.createConnection(connectionInstance.config);
				handleDisconnect(connection);
				connection.connect();
			}, 2000);
		});
	}

	if (!pool) {
		handleDisconnect(connection);
	}

	var that = this;
	
	return this;
};

var mysqlPool; // this should be initialized only once.
var mysqlCharset;

var Pool = function (settings) {
	if (!mysqlPool) {
		var mysql = require('mysql');

		var poolOption = {
			createConnection: settings.createConnection,
			waitForConnections: settings.waitForConnections,
			connectionLimit: settings.connectionLimit,
			queueLimit: settings.queueLimit
		};
		Object.keys(poolOption).forEach(function (element) {
			// Avoid pool option being used by mysql connection.
			delete settings[element];
			// Also remove undefined elements from poolOption
			if (!poolOption[element]) {
				delete poolOption[element];
			}
		});

		// Confirm settings with Adapter.
		var db = new Adapter(settings);
		var connectionSettings = db.connectionSettings();

		Object.keys(connectionSettings).forEach(function (element) {
			poolOption[element] = connectionSettings[element];
		});

		mysqlPool = mysql.createPool(poolOption);
		mysqlCharset = settings.charset;
	}

	this.pool = function () {
		return mysqlPool;
	};

	this.getNewAdapter = function (responseCallback) {
		mysqlPool.getConnection(function (err, connection) {
			if (err) {
				throw err;
			}
			var adapter = new Adapter({
				pool: {
					pool: mysqlPool,
					enabled: true,
					connection: connection
				},
				charset: mysqlCharset
			});
			responseCallback(adapter);
		});
	};

	this.disconnect = function (responseCallback) {
		this.pool().end(responseCallback);
        };

	return this;
};

exports.Adapter = Adapter;
exports.Pool = Pool;
