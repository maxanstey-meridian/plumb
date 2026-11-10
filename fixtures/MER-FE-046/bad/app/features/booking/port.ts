import { useProvideInject } from "../../shared/use-provide-inject";

export type Booking = { book(roomId: string): Promise<void> };

export const [injectBooking, provideBooking] = useProvideInject<Booking>("Booking");
