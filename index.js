const WebSocket = require('ws');
const AWS = require('aws-sdk');
const {v4: uuidv4} = require('uuid');
const {post} = require("axios");

let games = [];
let userWebSocketMap = {};
const wss = new WebSocket.Server({port: 8081});
const CLIENT_ID = "1nbjcn2p356d6eb8760os6qo1h"
const cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider({
    region: 'us-east-1'
});
const lambdaURL = process.env.API+"/update-ranking";

const s3 = new AWS.S3();
const dynamodb = new AWS.DynamoDB({
    region: 'us-east-1'
});

const uploadBase64ToS3 = async (base64String) => {
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        throw new Error('Invalid base64 string format');
    }
    const contentType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    const key = uuidv4();
    const bucketName = "tick-user-photos";

    const uploadParams = {
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentEncoding: 'base64',
        ContentType: contentType
    };

    try {
        await s3.upload(uploadParams).promise();
        const url = `https://${bucketName}.s3.amazonaws.com/${key}`;
        return url;
    } catch (err) {
        console.error('Error uploading file to S3:', err);
        throw err;
    }
};

wss.on('listening', () => {
    console.log('WebSocket server started and listening on port 8080');
});

wss.on('connection', function connection(ws) {
    console.log('WebSocket connection established');
    ws.send(JSON.stringify({type: 'connected'}));
    ws.on('message', async function incoming(message) {
        console.log('Received message:', message);
        console.log("API", )
        const data = JSON.parse(message);
        if (!data) return;
        switch (data.type) {
            case 'register':
                console.log(data)
                await handleRegister(ws, data);
                break;
            case 'login':
                await handleLogin(ws, data);
                break;
            case 'refresh_token':
                await refreshToken(ws, data);
                break;
            case 'start_game':
                await startGameUser(ws, data);
                break;
            case 'gameMove':
                await handleGameMove(ws, data);
                break;
            case 'gameEnd':
                await handleGameEnd(ws, data);
                break;
            case 'updateRanking':
                await updateRanking(ws,data);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
    });
});

async function updateRanking(ws,data){
    console.log("Update ranking", data);
    const {user_id, isWin} = data;
    post(lambdaURL,{user_id, isWin}).then(
        (res) => console.log(res)
    )
        .catch(err =>
            console.log(err)
        )
}

async function refreshToken(ws, data) {
    console.log('Handling refresh token request:', data);
    const {refreshToken} = data;
    try {
        const params = {
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            ClientId: CLIENT_ID,
            AuthParameters: {
                REFRESH_TOKEN: refreshToken
            }
        };


        const authData = await cognitoIdentityServiceProvider.initiateAuth(params).promise();
        console.log('Access token refreshed successfully:', authData);
        const accessToken = authData.AuthenticationResult.AccessToken;
        const newRefreshToken = authData.AuthenticationResult.RefreshToken;
        ws.send(JSON.stringify({type: 'refresh_success', accessToken, refreshToken: newRefreshToken}));
    } catch (error) {
        console.log('Refresh failed:', error);
        ws.send(JSON.stringify({type: 'refresh_failed'}));
    }
}

async function checkAccessToken(ws, accessToken) {
    try {
        const params = {
            AccessToken: accessToken
        };

        await cognitoIdentityServiceProvider.getUser(params).promise();
        return true;
    } catch (error) {
        ws.send(JSON.stringify({type: 'access_token_invalid'}));
        return false;
    }

}

async function getUserPhoto(accessToken) {
    try {
        const params = {
            AccessToken: accessToken
        };

        const userData = await cognitoIdentityServiceProvider.getUser(params).promise();
        return userData.UserAttributes.find((el) => el.Name === "picture").Value
    } catch (err) {
        console.error('Error retrieving user attributes:', err);
        throw err;
    }
}

async function startGameUser(ws, data) {
    console.log('Handling start game request:', data)
    const {username, access_token} = data;
    if (!username) return;
    const valid = await checkAccessToken(ws, access_token);
    if (!valid) return;
    userWebSocketMap[username] = ws;
    const usernames = Object.keys(userWebSocketMap);
    console.log('Usernames:', usernames)
    if (usernames.length < 2) return;
    if(usernames.length > 2){
        userWebSocketMap = {};
        games = []
    }
    const [username1, username2] = usernames.splice(0, 2);
    console.log(usernames)
    const game1 = games.find((game) => game.username1 === username1)
    const game2 = games.find((game) => game.username2 === username2)


    if (!game1 && !game2) {
        const gameID = uuidv4();
        games.push({gameID, username1, username2});
        userWebSocketMap[username1].send(JSON.stringify({type: 'game_start', gameID, isX: true}));
        userWebSocketMap[username2].send(JSON.stringify({type: 'game_start', gameID, isX: false}));
    } else {
        userWebSocketMap[username1].send(JSON.stringify({type: 'game_start', gameID: game1.gameID, isX: true}));
        userWebSocketMap[username2].send(JSON.stringify({type: 'game_start', gameID: game2.gameID, isX: false}));
    }

}

async function handleRegister(ws, data) {
    console.log('Handling register request:', data);
    const {username, email, password, image} = data;

    if (userWebSocketMap.hasOwnProperty(username)) {
        console.log('Username is already in use');
        ws.send(JSON.stringify({type: 'register_failed', error: 'Username is already in use'}));
        return;
    }
    const url = await uploadBase64ToS3(image)
    try {
        const params = {
            ClientId: CLIENT_ID,
            Password: password,
            Username: username,
            UserAttributes: [
                {
                    Name: 'email',
                    Value: email
                },
                {
                    Name: 'picture',
                    Value: url
                }
            ]
        };

        await cognitoIdentityServiceProvider.signUp(params).promise();

        console.log('User registered successfully');
        ws.send(JSON.stringify({type: 'register_success', message: 'User registered successfully'}));
    } catch (error) {
        console.log('Registration failed:', error);
        ws.send(JSON.stringify({type: 'register_failed', error: 'Registration failed'}));
    }
}


async function handleLogin(ws, data) {
    console.log('Handling login request:', data);

    const {username, password} = data;

    try {
        const authParams = {
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: CLIENT_ID,
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password
            }
        };

        const authData = await cognitoIdentityServiceProvider.initiateAuth(authParams).promise();
        const accessToken = authData.AuthenticationResult.AccessToken;
        const refreshToken = authData.AuthenticationResult.RefreshToken;

        const url = await getUserPhoto(accessToken)
        ws.send(JSON.stringify({
            type: 'login_success',
            accessToken: accessToken,
            refreshToken: refreshToken,
            photo: url
        }));
    } catch (error) {
        console.error('Login failed:', error);
        // Send an error response to the client
        ws.send(JSON.stringify({type: 'login_failed', error: 'Invalid username or password'}));
    }
}

async function handleGameMove(ws, data) {
    console.log('Handling game move:', data);
    const {access_token} = data;
    const valid = await checkAccessToken(ws, access_token);
    if (!valid) return;

    const {gameID, move, username} = data;
    const game = games.find(game => game.gameID === gameID);
    if (!game) return;

    const opponentUsername = game.username1 === username ? game.username2 : game.username1;
    userWebSocketMap[opponentUsername].send(JSON.stringify({type: `move`, move: move}));
}

async function handleGameEnd(ws, data) {
    console.log('Handling game end:', data);
    const {access_token, gameID, username, result} = data;
    const valid = await checkAccessToken(ws, access_token);
    if (!valid) return;
    const game = games.find(game => game.gameID === gameID);
    if(!game) return;
    if (result === 1) {
        const userNameWinner = username;
        const userNameLoser = game.username1 === username ? game.username2 : game.username1;
        const params = {
            TableName: 'GameTable',
            Item: {
                'game_id': {S: game.gameID},
                'user1_id': {S: userNameWinner},
                'user2_id': {S: userNameLoser},
                'winner_user_id': {S: username}
            }
        };
        dynamodb.putItem(params, (err, data) => {
            if (err) {
                console.error("Error putting item in DynamoDB:", err);
            } else {
                console.log("Successfully put item in DynamoDB");
            }
        });
        const {gameID} = data;
        games = []
        userWebSocketMap = {}
        games = games.filter(game => game.gameID !== gameID);
    } else if (result === 0) {
        const userName2 = game.username1 === username ? game.username2 : game.username1;
        const params = {
            TableName: 'GameTable',
            Item: {
                'game_id': {S: game.gameID},
                'user1_id': {S: username},
                'user2_id': {S: userName2},
                'winner_user_id': {S: ""}
            }
        };
        dynamodb.putItem(params, (err, data) => {
            if (err) {
                console.error("Error putting item in DynamoDB:", err);
            } else {
                console.log("Successfully put item in DynamoDB");
            }
        });
        const {gameID} = data;
        games = []
        userWebSocketMap = {}
        games = games.filter(game => game.id !== gameID);
    }



}
