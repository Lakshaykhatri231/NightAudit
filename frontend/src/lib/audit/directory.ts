/**
 * Fixed display details for the two hotels and the four demo users.
 * Who may open what is decided by the Python server (403), never here.
 */
import harbourlightImage from "@/assets/harbourlight-etching.jpg";
import pinecrestImage from "@/assets/pinecrest-etching.jpg";
import type { Hotel, HotelId, User } from "./types";

export const HOTELS: Record<HotelId, Hotel> = {
  harbourlight: {
    id: "harbourlight",
    name: "Harbourlight",
    fullName: "Harbourlight Boutique Hotel",
    place: "A harbour-front boutique hotel on the coastal waterfront",
    code: "HL",
    tone: "harbour",
    vault: "data/tenants/harbourlight.db",
    image: harbourlightImage,
  },
  pinecrest: {
    id: "pinecrest",
    name: "Pinecrest",
    fullName: "Pinecrest Mountain Lodge",
    place: "A timber lodge for skiers and hikers under the high pines",
    code: "PC",
    tone: "pine",
    vault: "data/tenants/pinecrest.db",
    image: pinecrestImage,
  },
};

/** Same users as hotelreports/config.py USERS. Each belongs to exactly one hotel. */
export const USERS: User[] = [
  { id: "anna@harbourlight", name: "Anna Patel", role: "analyst", hotel: "harbourlight", title: "Analyst · Harbourlight", room: "101" },
  { id: "rob@harbourlight", name: "Rob Chen", role: "reviewer", hotel: "harbourlight", title: "Reviewer · Harbourlight", room: "102" },
  { id: "paul@pinecrest", name: "Paul Okafor", role: "analyst", hotel: "pinecrest", title: "Analyst · Pinecrest", room: "201" },
  { id: "rita@pinecrest", name: "Rita Novak", role: "reviewer", hotel: "pinecrest", title: "Reviewer · Pinecrest", room: "202" },
];

export const DEMO_PASSWORD = "demo123";

export const userById = (id: string | null | undefined) => USERS.find((u) => u.id === id) ?? null;
/** Display name for a username in the logs ("system" is the server itself). */
export const nameOf = (id: string | null | undefined) => (id === "system" ? "System" : (userById(id)?.name ?? id ?? "—"));
export const analystOf = (hotel: HotelId) => USERS.find((u) => u.hotel === hotel && u.role === "analyst")!;

export function isHotelId(v: string): v is HotelId {
  return Object.hasOwn(HOTELS, v);
}

/** Short reference shown on reports, e.g. "PC-2026-10-#3". */
export const reportCode = (hotel: HotelId, r: { id: number; period_start: string }) =>
  `${HOTELS[hotel].code}-${r.period_start.slice(0, 7)}-#${r.id}`;
