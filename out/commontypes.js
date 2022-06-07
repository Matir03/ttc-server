export const colors = ["White", "Black", "Random"];
export class MappedLobbyState {
    constructor(state) {
        this.seeks = new Map(state.seeks.map(seek => [seek.id, seek]));
    }
    insert(seek) {
        this.seeks.set(seek.id, seek);
    }
    remove(id) {
        this.seeks.delete(id);
    }
    toLobbyState() {
        return {
            seeks: Array.from(this.seeks, ([id, seek]) => seek)
        };
    }
}
export class MakeSeek {
    constructor(color) {
        this.kind = "MakeSeek";
        this.color = color;
    }
}
export class DeleteSeek {
    constructor(id) {
        this.kind = "DeleteSeek";
        this.id = id;
    }
}
export class AcceptSeek {
    constructor(id) {
        this.kind = "AcceptSeek";
        this.id = id;
    }
}
export class AddSeek {
    constructor(seek) {
        this.kind = "AddSeek";
        this.seek = seek;
    }
}
export class RemoveSeek {
    constructor(id) {
        this.kind = "RemoveSeek";
        this.id = id;
    }
}
export class MakeMove {
    constructor(move) {
        this.kind = "MakeMove";
        this.move = move;
    }
}
export class PerformMove {
    constructor(move, color) {
        this.kind = "PerformMove";
        this.move = move;
        this.color = color;
    }
}
