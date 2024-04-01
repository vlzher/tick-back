const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

let games = [];
let usernamesQueue = [];
const userWebSocketMap = {};
const wss = new WebSocket.Server({ port: 8080 });

wss.on('listening', () => {
    console.log('WebSocket server started and listening on port 8080');
});

wss.on('connection', function connection(ws) {
    console.log('WebSocket connection established');

    ws.on('message', function incoming(message) {
        console.log('Received message:', message);

        const data = JSON.parse(message);
        switch (data.type) {
            case 'login':
                handleLogin(ws, data);
                break;
            case 'gameMove':
                handleGameMove(ws, data);
                break;
            case 'gameEnd':
                handleGameEnd(ws, data);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
    });
});

function getTwoRandomNumbersInRange(min, max) {
    let num1 = Math.floor(Math.random() * (max - min + 1)) + min;
    let num2 = Math.floor(Math.random() * (max - min + 1)) + min;
    while (num2 === num1) {
        num2 = Math.floor(Math.random() * (max - min + 1)) + min;
    }
    return [num1, num2];
}

function handleLogin(ws, data) {
    console.log('Handling login request:', data);

    const { username } = data;
    if (!usernamesQueue.includes(username)) {
        console.log('Username is available');
        userWebSocketMap[username] =  ws;
    } else {
        console.log('Username is already in use');
        return;
    }
    usernamesQueue.push(username);
    if(usernamesQueue.length < 2) return;
    const [firstNumber, secondNumber] = getTwoRandomNumbersInRange(0, usernamesQueue.length-1);
    const username1 = usernamesQueue[firstNumber];
    const username2 = usernamesQueue[secondNumber];
    usernamesQueue = usernamesQueue.filter((_, index) => index !== firstNumber && index !== secondNumber);
    const gameID = uuidv4();
    games.push({gameID, username1, username2});
    userWebSocketMap[username1].send(JSON.stringify({type: `gameStart`, gameID, isX: true}));
    userWebSocketMap[username2].send(JSON.stringify({type: `gameStart`, gameID, isX: false}));
}

function handleGameMove(ws, data) {
    console.log('Handling game move:', data);

    const {gameID, move, username} = data;
    const game = games.find(game => game.gameID === gameID);
    if(!game) return;
    const opponentUsername = game.username1 === username ?  game.username2 : game.username1;
    userWebSocketMap[opponentUsername].send(JSON.stringify({type: `move`, move: move}));
}

function handleGameEnd(ws, data) {
    console.log('Handling game end:', data);

    const {gameID} = data;
    games = games.filter(game => game.id !== gameID);
}
