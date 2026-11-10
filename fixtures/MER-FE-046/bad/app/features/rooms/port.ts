import { useProvideInject } from "../../shared/use-provide-inject";

export type Rooms = { list(): Promise<string[]> };

export const [injectRooms, provideRooms] = useProvideInject<Rooms>("Rooms");
