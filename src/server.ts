import { SOCKET_PORT } from './config.js';
import { Server } from 'socket.io';
import { AcceptSeek, AddSeek, DeleteSeek, Action, ChatAction,
    MakeMove, MakeSeek, MappedLobbyState, PerformMove, 
    RemoveSeek, Seek, ChatEvent, ChatMessage, TaggedAction, UpdatePlayer } from './commontypes.js';
import { TTCServer, TTCSocket, GameState, ServerLobbyState } from './servertypes.js';
import { opposite } from './ttc/board.js';

const io: TTCServer = new Server(SOCKET_PORT, {
    serveClient: false,
    cors: {origin: '*'}
});

let maxPID = 0, maxGID = 0;
const sockets = new Map<string, TTCSocket>();
const lobby = new ServerLobbyState({
    seeks: [], 
    games: [],
    players: [],
    chat: []
}, io.to('lobby'));
const games = new Map<string, GameState>();

console.log(`Server running on port ${SOCKET_PORT}`);

io.on("connection", (socket) => {
    console.log(`Socket ${socket.id} connected`);

    socket.on("player_join", (pname) => {
        if(!pname) {
            console.log(`Socket ${socket.id} sent invalid name`);
            socket.disconnect();
            return;
        }

        socket.data.name = pname
        console.log(`Socket ${socket.id} has name ${socket.data.name}`);

        if(sockets.has(pname)) {
            const oldsocket = sockets.get(pname);
            
            console.log(`Existing socket ${oldsocket.id} with same name`);
            
            if(!oldsocket.disconnected) {
               console.log('Existing socket still active');
               
               socket.disconnect();

               return;
            }

            let room = oldsocket.data.room;
            if(!room) room = "lobby";

            console.log(`Sending socket ${socket.id} 
                to room ${oldsocket.data.room}`);

            updateRoom(socket, room);
            
            oldsocket.disconnect();
            console.log(`Socket ${oldsocket.id} disconnected`);
        } else {
            console.log(`Sending new socket ${socket.id} to lobby`);
            updateRoom(socket, "lobby");
        }

        sockets.set(pname, socket);

        socket.on("lobby_action", lobbyActionHandler(socket));
        socket.on("game_action", gameActionHandler(socket));

        socket.on("disconnect", () => {
            console.log(`Socket ${socket.id} disconnected`);
            sockets.delete(pname);

            lobby.updatePlayer({
                name: pname,
                status: "offline"
            });

            if(socket.data.room === "lobby") {
                lobby.removePlayer(pname);
            }
        });
    });
});

function updateRoom(socket: TTCSocket, room: string) {
    const pname = socket.data.name;

    if(socket.data.room)
        socket.leave(socket.data.room);

    socket.data.room = room;
    socket.join(room);

    if(room === "lobby") { 
        const state = lobby.toLobbyState();
        socket.emit("join_lobby", state);
        console.log(`Lobby state ${JSON.stringify(state)} 
            sent to socket ${socket.id}`);

        lobby.updatePlayer({
            name: pname,
            status: "online"
        });
    } else {
        const state = games.get(room);
        socket.emit("join_game", state.plain());
        console.log(`Game state ${JSON.stringify(state)}
            sent to socket ${socket.id}`);
        
        lobby.updatePlayer({
            name: pname,
            status: "playing"
        });
    }
}

function lobbyActionHandler(socket: TTCSocket) {
    return (action: Action) => {

        console.log(`Receiving lobby action ${JSON.stringify(action)}`);

        if(lobby.players.get(socket.data.name).status !== "online") return;

        if(action.kind === "MakeSeek") {

            const seek: Seek = {
                id: maxPID++,
                player: socket.data.name,
                color: (action as MakeSeek).color
            };

            console.log(`New seek: ${JSON.stringify(seek)}`);

            lobby.insertSeek(seek);

        } else if(action.kind === "DeleteSeek") {

            const id = (action as DeleteSeek).id;
            
            console.log(`Deleting seek ${id}`);

            lobby.removeSeek(id);

        } else if(action.kind === "AcceptSeek") {

            const id = (action as AcceptSeek).id;
            const seek = lobby.seeks.get(id);

            if(!seek) return;

            const socket2 = sockets.get(seek.player);

            console.log(`${socket.data.name} accepted seek 
                ${JSON.stringify(seek)}`);
                
            const white = (seek.color === "Black") ||
                (seek.color === "Random" && Math.random() < 0.5);
            
            if(white) {
                newGame(socket, socket2);
            } else {
                newGame(socket2, socket);
            }
        } else if(action.kind === "ChatAction") {
            const msg = {
                sender: socket.data.name,
                text: (action as ChatAction).message
            };
            
            lobby.updateChat(msg);
        }

        console.log(`New lobby state: 
            ${JSON.stringify(lobby.toLobbyState())}`);
    };
}

function newGame(wSocket: TTCSocket, bSocket: TTCSocket) {
    const gid = maxGID++;
    const room = "game" + gid;
    
    games.set(room, new GameState( 
        wSocket.data.name,
        bSocket.data.name
    ));

    console.log(`Creating new game ${JSON.stringify(games.get(room))} 
        in room ${room}`);

    updateRoom(wSocket, room);
    updateRoom(bSocket, room);

    lobby.removePlayer(wSocket.data.name);
    lobby.removePlayer(bSocket.data.name);

    lobby.updateGame({
        id: gid,
        white: wSocket.data.name,
        black: bSocket.data.name,
        status: "playing"
    });

    lobby.updateChat({
        sender: '',
        text: `${wSocket.data.name} and ${bSocket.data.name} are playing`
    });
}

function gameActionHandler(socket: TTCSocket) {
    return (action: Action) => {
        const game = socket.data.room;
        const pname = socket.data.name;

        console.log(`Receiving game action ${JSON.stringify(action)}
        from ${pname} in ${game}`);

        const state = games.get(game);
        
        const sendMsg = (msg: ChatMessage) => {
                state.chat.push(msg);
                io.to(game).emit("game_event", new ChatEvent(msg));
        };

        const endGame = (result: string) => {
            sendMsg({
                sender: "",
                text: `Game ended in a ${
                    result === "draw" ? "draw" :
                    `win for ${result}`
                }`
            });

            io.to(game).emit("game_event", {kind: "GameEnd"});
            
            lobby.updateGame({
                id: parseInt(game.slice(4)),
                white: state.white,
                black: state.black,
                status: result === "draw" ? "draw" :
                    `${result} won`
            });

            lobby.updateChat({
                sender: '',
                text: result === "draw" ? 
                    `${state.white} and ${state.black} drew` : 
                    result === "white" ?
                        `${state.white} won against ${state.black}` :
                        `${state.black} won against ${state.white}`
            });

            state.ended = true;
        };

        const color = pname === state.white ?
            "white" : "black";
            
        switch(action.kind) {

            case "MakeMove":

                if(state.ended) return;

                const move = (action as MakeMove).move;
                
                console.log(`Making move ${JSON.stringify(move)} 
                    in ${game}`);

                if(state.game.makeMove(move)) {
                    io.to(game).emit("game_event", 
                        new PerformMove(move, color));
                    
                    const result = state.game.board.result();

                    if(result !== "none") {
                        console.log(`Game ended normally in ${game}`);
                        endGame(result);
                        return;
                    }

                    if(state.drawOffer === opposite(color))
                        state.drawOffer = "";
                }
                else 
                    console.log(`Illegal move in ${game}!`);
                
                break;

            case "ChatAction":

                const msg = (action as ChatAction).message;
                console.log(`Chat message "${msg}" in ${game}`);

                const taggedMsg = {
                    sender: pname,
                    text: msg,
                };

                sendMsg(taggedMsg);

                break;

            case "Resign":

                if(state.ended) return;

                const winner = pname === state.white ?
                    "black" : "white";

                console.log(`${pname} resigned in ${game}`);
                sendMsg({
                    sender: '',
                    text: `${pname} resigned`
                })

                endGame(winner);
            
                break;

            case "Offer Draw":

                if(state.ended) return;

                console.log(`${pname} offered draw in ${game}`);

                if(state.drawOffer) {
                    if(state.drawOffer === pname) return;

                    sendMsg({
                        sender: '',
                        text: "Players agreed to a draw"
                    });

                    endGame("draw");
                    return;
                }
                
                state.drawOffer = pname;

                sendMsg({
                    sender: '', 
                    text: `${pname} offered a draw`
                });

                io.to(game).emit("game_event", {
                    kind: "DrawOffered",
                    player: pname
                } as TaggedAction);

                break;
            
            case "Accept Draw":

                if(state.ended) return;

                if(!state.drawOffer ||
                    state.drawOffer === pname) return;

                console.log(`${pname} accepted draw in ${game}`);
                sendMsg({
                    sender: '',
                    text: `${pname} accepted a draw`
                });

                endGame("draw");

                break;
            
            case "Decline Draw":

                if(state.ended) return;

                if(!state.drawOffer ||
                    state.drawOffer === pname) return;

                console.log(`${pname} declined draw in ${game}`);

                sendMsg({
                    sender: '',
                    text: `${pname} declined a draw`
                });

                state.drawOffer = "";

                break;

            case "Claim Draw":

                if(state.ended) return;

                if(!state.game.canClaimDraw()) return;

                console.log(`${pname} claimed draw in ${game}`);

                sendMsg({
                    sender: '',
                    text: `${pname} claimed a draw`
                });

                endGame("draw");

                break;

            case "Exit Game":

                if(!state.ended) return;

                console.log(`${pname} exited game ${game}`);
                
                state.rematch = "never";

                sendMsg({
                    sender: '',
                    text: `${pname} left the game`
                });

                updateRoom(socket, "lobby");
                break;
                
            case "Rematch":

                if(!state.ended) return;

                console.log(`${pname} requested rematch in ${game}`);

                if(state.rematch) {
                    if(state.rematch === pname ||
                        state.rematch === "never") return;

                    sendMsg({
                        sender: '',
                        text: "Players agreed to a rematch"
                    });                    

                    state.rematch = "";

                    newGame(sockets.get(state.black), sockets.get(state.white));

                    return;
                }

                state.rematch = pname;

                sendMsg({
                    sender: '',
                    text: `${pname} wants a rematch`
                })

                break;

            default:
                console.log(`Unknown game action type: ${action.kind}`);
        }
    };
}