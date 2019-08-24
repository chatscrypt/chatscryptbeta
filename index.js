var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;
const moment = require('moment'); // for timestamps

var MongoClient = require('mongodb').MongoClient;

// If you change the database, change BOTH URL and the constant database!
var url = "mongodb+srv://chatscrypt:my1password@chatscrypt-kvqx0.mongodb.net/test?retryWrites=true&w=majority";
const database = "betadb";
var connection = MongoClient.connect(url, {useNewUrlParser: true});

var onlineList = [];
var maxChatID = 0;

app.get('/', function(req, res){
	res.sendFile(__dirname + '/index.html');
});

connection.then(function(db){
	var myquery = { dataName: "maxChatID" };
	connection.then(function(db){			
		db.db(database).collection("data").find(myquery).toArray(function(err, result) {
			if (err) throw err;
			if (result.length == 0) {
				var newChatIDNumber = { dataName: "maxChatID", dataValue:0 };
				db.db(database).collection("data").insertOne(newChatIDNumber, function(err, res) {
					if (err) throw err;
				});
			}
			else {
				maxChatID = result[0].dataValue;
			}
		});
	});		  
}); 

io.on('connection', function(socket){
	
	socket.username = '';
		
	socket.on('regCue', function(data){		
		if (data.username.length < 2)
		{
			socket.emit('regShortCue');
			return false;
		}
		
		var query = { username: data.username };
		connection.then(function(db){
			db.db(database).collection("users").find(query).toArray(function(err, result) {
				if (err) throw err;
				if (result.length == 0) {
					db.db(database).collection("users").insertOne(data, function(err, res) {
						if (err) throw err;
					});
					socket.emit('regConfirmCue');
				}
				else {
					socket.emit('regExistCue');
				}
			});
		}); 
	});

	
	
	socket.on('loginCue', function(data) {		
		connection.then(function(db){
			db.db(database).collection("users").find(data).toArray(function(err, result) {
				if (err) throw err;
				if (result.length == 0) {
					socket.emit('loginFailCue');
				}
				else {
					socket.username = data.username;
					socket.join('loggedIn');
					if (onlineList.includes(socket.username) == false) 
					{
						onlineList.push(data.username);
						socket.broadcast.to('loggedIn').emit('newcomerCue', data.username);
					}
					
					db.db(database).collection("messages").find({ $or:[{ listeners: data.username }, { speaker: socket.username }] }).toArray(function(err, res) {
						if (err) throw err;
						var recent = 0;
						var defaultListeners = [];
						var currentChatID = 0;
						for (x in res){
							if (res[x].time > recent)
							{
								recent = res[x].time;
								currentChatID = res[x].chatID;
								if (res[x].speaker == socket.username)
									defaultListeners = res[x].listeners;
							}
						}
						socket.emit('loginConfirmCue', { username:socket.username, chatList:result[0].chatList, usernames:onlineList, listeners:defaultListeners, msgs:res, currentChatID:currentChatID });
					});					
				}
			});
		});
	});
	
	socket.on('logoutCue', function(){
		socket.leave('loggedIn');	
		
		for(i = 0; i < onlineList.length; i++)
		{
			if (onlineList[i] == socket.username)
			{
				onlineList.splice(i, 1);
				io.to('loggedIn').emit('departureCue', socket.username);
				i--;
			}
		}
		
		socket.username = '';
	});
  
	socket.on('disconnect', function(){	
		if (socket.username != '')
		{
			for(i = 0; i < onlineList.length; i++)
			{
				if (onlineList[i] == socket.username)
				{
					onlineList.splice(i, 1);
					io.to('loggedIn').emit('disconnectCue', socket.username);
					i--;
				}
			}
			
			socket.username = '';
		}
	});
  
	socket.on('clientMsgCue', function(data){
		
		var currentChatID = data.chatID;		
		if (data.chatID == 0) {
			maxChatID++;
			currentChatID = maxChatID;
			var myQuery = { dataName: "maxChatID" };
			var newValues = { $set: {dataValue: maxChatID } };
			connection.then(function(db){			
				db.db(database).collection("data").updateOne(myQuery, newValues, function(err, res) {
					if (err) throw err;
				});
			});
		}
		
		
		// send to listed listeners
		for (i = 0; i < data.listeners.length; i++)
		{
			for (x in io.sockets.adapter.rooms['loggedIn'].sockets)
			{
				if (io.sockets.connected[x].username == data.listeners[i])
					io.sockets.connected[x].emit('serverMsgCue', { speaker:socket.username, msg:data.msg, time:data.time, chatID:currentChatID });
			}
		}
		
		// add message to database
		var dbData = { speaker:socket.username, listeners:data.listeners, msg:data.msg, time:data.time, chatID:currentChatID };
		connection.then(function(db){
				db.db(database).collection("messages").insertOne(dbData, function(err, res) {
					if (err) throw err;
				});
		});
		
		// add chatID to all the listener's chatLists, if not already there
		connection.then(function(db){		
			for (i = 0; i < data.listeners.length; i++) {
				db.db(database).collection("users").updateOne( { username: data.listeners[i] }, { $addToSet: { chatList: currentChatID } }, function(err, res) {
					if (err) throw err;
					for (x in io.sockets.adapter.rooms['loggedIn'].sockets)
					{
						if (io.sockets.connected[x].username == data.listeners[i])
							io.sockets.connected[x].emit('addChatIDCue', currentChatID);
					}							
				});
			}
			
			// also possibly add to self
			db.db(database).collection("users").updateOne({ username: socket.username },  { $addToSet: { chatList: currentChatID } }, function(err, res) {
				if (err) throw err;
				socket.emit('addChatIDCue', currentChatID);
			});
		});
		
		
		// send to self as well, since not listed as a listener
		socket.emit('serverMsgCue', { speaker:socket.username, msg:data.msg, time:data.time, chatID:currentChatID });
	});
	
	socket.on('addListenerCue', function(candidate){
		if (socket.username == candidate) 
		{
			socket.emit('selfListenerCue');
			return false;
		}
		
		connection.then(function(db){
			db.db(database).collection("users").find({ username: candidate }).toArray(function(err, result) {
				if (err) throw err;
				if (result.length == 0) 
					socket.emit('addListenerFailCue');
				else
					socket.emit('addListenerConfirmCue', candidate);
			});
		});	
	});	
});


http.listen(port, function(){
	console.log('listening on *:' + port);
});
