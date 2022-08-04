import { SOCKET_PORT } from './config.js';
import { Server } from 'socket.io';
import { AcceptSeek, AddSeek, DeleteSeek, Action, ChatAction,
    MakeMove, MakeSeek, MappedLobbyState, PerformMove, WatchPlayer,
    RemoveSeek, Seek, ChatEvent, ChatMessage, TaggedAction, 
    WatchGame, UpdatePlayer, ClockInfo } from './commontypes.js';
import { TTCServer, TTCSocket, GameState, ServerLobbyState } from './servertypes.js';
import { opposite } from './ttc/board.js';
import { Color } from './ttc/types.js';

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
}, io);
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
    if(socket.data.room === room) return;
    const pname = socket.data.name;

    if(socket.data.room)
        socket.leave(socket.data.room);

    socket.data.room = room;
    socket.join(room);

    if(room === "lobby") { 
        const state = lobby.toLobbyState(socket.data.name);
        socket.emit("join_lobby", state);
        console.log(`Lobby state ${JSON.stringify(state)} 
            sent to socket ${socket.id}`);

        lobby.updatePlayer({
            name: pname,
            status: "online"
        });
    } else {
        const state = games.get(room);
        
        if(state.white === pname || 
            state.black === pname) {
            socket.emit("join_game", state.plain());
            lobby.updatePlayer({
                name: pname,
                status: "playing"
            });
        } else {
            socket.emit("join_game", state.specPlain());
            lobby.updatePlayer({
                name: pname,
                status: "spectating"
            });
        }

        console.log(`Game state ${JSON.stringify(state)}
            sent to socket ${socket.id}`);
    }
}

function lobbyActionHandler(socket: TTCSocket) {
    return (action: Action) => {

        console.log(`Receiving lobby action ${JSON.stringify(action)}`);

        if(lobby.players.get(socket.data.name).status !== "online") return;

        if(action.kind === "MakeSeek") {

            const data = action as MakeSeek;

            const seek: Seek = {
                id: maxPID++,
                player: socket.data.name,
                opponent: data.opponent,
                color: data.color,
                timeWhite: data.timeWhite,
                timeBlack: data.timeBlack,
            };

            console.log(`New seek: ${JSON.stringify(seek)}`);

            lobby.insertSeek(seek, seek.opponent ? [
                socket.id,
                sockets.get(seek.opponent)?.id
            ] : null);

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
            
            const clockInfo ={
                white: seek.timeWhite,
                black: seek.timeBlack,
                timeleft: [
                    seek.timeWhite?.base,
                    seek.timeBlack?.base
                ],
                timestamp: Date.now()
            }
            
            if(white) {
                newGame(socket, socket2, clockInfo);
            } else {
                newGame(socket2, socket, clockInfo);
            }
        } else if(action.kind === "ChatAction") {
            const msg = {
                sender: socket.data.name,
                text: (action as ChatAction).message
            };
            
            lobby.updateChat(msg);
        } else if(action.kind === "WatchGame") {
            const id = (action as WatchGame).id;
            const room = `game${id}`;
            if(!games.has(room)) return;
            updateRoom(socket, room);
        } else if(action.kind === "WatchPlayer") {
            const name = (action as WatchPlayer).name;
            updateRoom(socket, sockets.get(name)?.data.room || "lobby");
        }

        console.log(`New lobby state: 
            ${JSON.stringify(lobby.toLobbyState())}`);
    };
}

function newGame(wSocket: TTCSocket, bSocket: TTCSocket, clockInfo: ClockInfo) {
    const gid = maxGID++;
    const room = "game" + gid;

    const state = new GameState( 
        wSocket.data.name,
        bSocket.data.name,
        clockInfo
    );
    games.set(room, state);

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

    if(clockInfo.white) {
        state.ticker = setTimeout(timeout, 
            clockInfo.white.base, room, "white");
    }
}

function timeout(room: string, color: Color) {
    const state = games.get(room);

    console.log(`${color} timed out in ${room}`);

    const msg1 = {
        sender: '',
        text: `${state[color]} has timed out`
    };

    const winner = opposite(color);

    const msg2 = {
        sender: '',
        text: `Game ended in a win for ${winner}`
    };

    const sendMsg = (msg: ChatMessage) => {
        state.chat.push(msg);
        state.specChat.push(msg);
        io.to(room).emit("game_event", new ChatEvent(msg));
    };

    sendMsg(msg1);
    sendMsg(msg2);

    io.to(room).emit("game_event", {kind: "GameEnd"});
            
    lobby.updateGame({
        id: parseInt(room.slice(4)),
        white: state.white,
        black: state.black,
        status: `${winner} won`
    });

    lobby.updateChat({
        sender: '',
        text: winner === "white" ?
            `${state.white} won against ${state.black}` :
            `${state.black} won against ${state.white}`
    });

    state.ended = true;
    state.ticker = null;
}

function gameActionHandler(socket: TTCSocket) {
    return (action: Action) => {
        const room = socket.data.room;
        const pname = socket.data.name;

        console.log(`Receiving game action ${JSON.stringify(action)}
        from ${pname} in ${room}`);

        const state = games.get(room);
        
        const sendMsg = (msg: ChatMessage) => {
                state.chat.push(msg);
                state.specChat.push(msg);
                io.to(room).emit("game_event", new ChatEvent(msg));
        };

        const endGame = (result: string) => {
            clearTimeout(state.ticker);
        
            sendMsg({
                sender: "",
                text: `Game ended in a ${
                    result === "draw" ? "draw" :
                    `win for ${result}`
                }`
            });

            io.to(room).emit("game_event", {kind: "GameEnd"});
            
            lobby.updateGame({
                id: parseInt(room.slice(4)),
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
            state.ticker = null;
        };

        if(pname !== state.white && pname !== state.black) {
            switch(action.kind) {
                case "Leave Game":
                    updateRoom(socket, "lobby");
                    break;
                
                case "ChatAction":
                    const msg = {
                        sender: pname,
                        text: (action as ChatAction).message
                    };
                    state.specChat.push(msg);
                    io.to(room).except([
                        sockets.get(state.white)?.id,
                        sockets.get(state.black)?.id
                    ]).emit("game_event", new ChatEvent(msg));
            }

            return;
        }

        const color = pname === state.white ?
            "white" : "black";
            
        switch(action.kind) {

            case "MakeMove":

                if(state.ended) return;

                const move = (action as MakeMove).move;
                
                console.log(`Making move ${JSON.stringify(move)} 
                    in ${room}`);

                if(state.game.makeMove(move)) {
                    const now = Date.now();

                    if(state.ticker) {
                        clearTimeout(state.ticker);

                        state.clockInfo.timeleft.push(
                            state.clockInfo.timeleft.at(-2) +
                            state.clockInfo[color].incr -
                            (now - state.clockInfo.timestamp));
                        
                        state.clockInfo.timestamp = now;

                        state.ticker = setTimeout(timeout,
                            state.clockInfo.timeleft.at(-2), room, 
                            opposite(color));
                    }

                    io.to(room).emit("game_event", new PerformMove(
                        move, color, now));
                    
                    const result = state.game.board.result();

                    if(result !== "none") {
                        console.log(`Game ended normally in ${room}`);
                        endGame(result);
                        return;
                    }

                    if(state.drawOffer === opposite(color))
                        state.drawOffer = "";
                }
                else 
                    console.log(`Illegal move in ${room}!`);
                
                break;

            case "ChatAction":

                const msg = (action as ChatAction).message;
                console.log(`Chat message "${msg}" in ${room}`);

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

                console.log(`${pname} resigned in ${room}`);
                sendMsg({
                    sender: '',
                    text: `${pname} resigned`
                })

                endGame(winner);
            
                break;

            case "Offer Draw":

                if(state.ended) return;

                console.log(`${pname} offered draw in ${room}`);

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

                io.to(room).emit("game_event", {
                    kind: "DrawOffered",
                    player: pname
                } as TaggedAction);

                break;
            
            case "Accept Draw":

                if(state.ended) return;

                if(!state.drawOffer ||
                    state.drawOffer === pname) return;

                console.log(`${pname} accepted draw in ${room}`);
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

                console.log(`${pname} declined draw in ${room}`);

                sendMsg({
                    sender: '',
                    text: `${pname} declined a draw`
                });

                state.drawOffer = "";

                break;

            case "Claim Draw":

                if(state.ended) return;

                if(!state.game.canClaimDraw()) return;

                console.log(`${pname} claimed draw in ${room}`);

                sendMsg({
                    sender: '',
                    text: `${pname} claimed a draw`
                });

                endGame("draw");

                break;

            case "Exit Game":

                if(!state.ended) return;

                console.log(`${pname} exited game ${room}`);
                
                state.rematch = "never";

                sendMsg({
                    sender: '',
                    text: `${pname} left the game`
                });

                updateRoom(socket, "lobby");
                break;
                
            case "Rematch":

                if(!state.ended) return;

                console.log(`${pname} requested rematch in ${room}`);

                if(state.rematch) {
                    if(state.rematch === pname ||
                        state.rematch === "never") return;

                    sendMsg({
                        sender: '',
                        text: "Players agreed to a rematch"
                    });                    

                    state.rematch = "";

                    newGame(sockets.get(state.black), sockets.get(state.white), {
                            white: state.clockInfo.black,
                            black: state.clockInfo.white,
                            timeleft: [
                                state.clockInfo.black.base,
                                state.clockInfo.white.base
                            ],
                            timestamp: Date.now()
                        });

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