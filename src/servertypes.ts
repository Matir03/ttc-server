import { BroadcastOperator, Server, Socket } from 'socket.io';
import { ClientToServerEvents, LobbyState,
    ReceivedGameState, Chat, Seek,
    ServerToClientEvents, ChatEvent, 
    MappedLobbyState,
    AddSeek, RemoveSeek, LobbyGame, UpdateGame, LobbyPlayer, UpdatePlayer, ChatMessage} from './commontypes.js';
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

export class ServerLobbyState extends MappedLobbyState {
    constructor(state: LobbyState, 
        public emitter: 
            BroadcastOperator<ServerToClientEvents, SocketData>) {
        super(state);
    }

    insertSeek(seek: Seek) {
        super.insertSeek(seek);
        this.emitter.emit("lobby_event", 
            new AddSeek(seek));
    } 

    removeSeek(id: number) {
        super.removeSeek(id);
        this.emitter.emit("lobby_event", 
            new RemoveSeek(id));
    }

    updateGame(game: LobbyGame) {
        super.updateGame(game);
        this.emitter.emit("lobby_event", 
            new UpdateGame(game));
    }

    updatePlayer(player: LobbyPlayer): void {
        super.updatePlayer(player);
        this.emitter.emit("lobby_event", 
            new UpdatePlayer(player));
    }

    updateChat(msg: ChatMessage): void {
        super.updateChat(msg);
        this.emitter.emit("lobby_event",
            new ChatEvent(msg));
    }

    removePlayer(name: string): void {
        [...this.seeks]
            .filter(([_, seek]) => seek.player === name)
            .forEach(([id, _]) => this.removeSeek(id));
    }
}
