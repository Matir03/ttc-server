import { Server, Socket } from 'socket.io';
import { ClientToServerEvents, 
    ReceivedGameState, Chat,
    ServerToClientEvents } from './commontypes.js';
import { Game } from './ttc/game.js';

interface InterServerEvents {}

interface SocketData {
    name: string;
    room: string;
}

export type TTCServer = Server<ClientToServerEvents, ServerToClientEvents, 
    InterServerEvents, SocketData>; 

export type TTCSocket = Socket<ClientToServerEvents, ServerToClientEvents,
    InterServerEvents, SocketData>;

export class GameState {
    white: string;
    black: string;
    game: Game;
    chat: Chat;
    drawOffer: string;
    ended: boolean;
    rematch: string;

    constructor(white: string, black: string) {
        this.white = white;
        this.black = black;
        this.game = new Game();
        this.chat = [{
            sender: "",
            text: `New game started between ${white} and ${black}`
        }];
        this.drawOffer = "";
        this.ended = false;
        this.rematch = "";
    }
    
    plain(): ReceivedGameState {
        return {
            white: this.white,
            black: this.black,
            game: this.game.moves,
            chat: this.chat,
            drawOffer: this.drawOffer
        };
    }
}
