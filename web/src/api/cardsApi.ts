/** Access-card issue / revoke and employee picker for the Cards panel. */
import { apiGet, apiPost, buildQuery } from "./http";

export type CardType =
  // Union/intersection type member.
  | "guest"
  // Union/intersection type member.
  | "housekeeper"
  // Union/intersection type member.
  | "maintenance"
  // Union/intersection type member.
  | "manager"
  // Union/intersection type member.
  | "master";

export type CardStatus = "active" | "revoked";

export type AccessCardGrant = {
  id: string;
  locationId: string | null;
  validFrom: string;
  validUntil: string;
  location: {
    id: string;
    number: string;
    floor: { number: number; building: { code: string; name: string } };
  } | null;
};

export type AccessCard = {
  id: string;
  cardType: CardType;
  status: CardStatus;
  label: string | null;
  employeeId: string | null;
  commandId: string;
  createdAt: string;
  employee: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
  issuedBy: {
    id: string;
    fullName: string;
    employeeNumber: string;
  };
  grants: AccessCardGrant[];
};

export type CardEmployeeOption = {
  id: string;
  fullName: string;
  employeeNumber: string;
  department: string | null;
};

/** List access cards with optional employee / status / type / search filters. */
export async function fetchCards(params?: {
  employeeId?: string;
  status?: CardStatus;
  cardType?: CardType;
  q?: string;
  staffOnly?: boolean;
}): Promise<AccessCard[]> {
  return apiGet(
    `/cards${buildQuery({
      employeeId: params?.employeeId,
      status: params?.status,
      cardType: params?.cardType,
      q: params?.q,
      staffOnly: params?.staffOnly || undefined,
    })}`,
  );
}

/** Employee picker options for issuing staff cards (optional name search). */
export async function fetchCardEmployees(
  q?: string,
): Promise<CardEmployeeOption[]> {
  return apiGet(`/cards/employees${buildQuery({ q })}`);
}

/** Issue a card; generates `commandId` when the caller does not supply one. */
export async function issueCard(input: {
  cardType: CardType;
  employeeId?: string | null;
  locationId?: string | null;
  validFrom: string;
  validUntil: string;
  label?: string | null;
  commandId?: string;
}): Promise<AccessCard> {
  return apiPost("/cards", {
    // Spread remaining fields/props.
    ...input,
    commandId: input.commandId ?? crypto.randomUUID(),
  });
}

/** Soft-revoke a card; returns the updated row with status `revoked`. */
export async function revokeCard(id: string): Promise<AccessCard> {
  return apiPost(`/cards/${id}/revoke`);
}
