export class OverloadedError extends Error {
    constructor(message: any) {
        super(message);
        this.name = "OverloadedError";
    }
}