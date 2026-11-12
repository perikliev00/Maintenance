/** Access-card issue / revoke and employee picker for the Cards panel. */
import { apiGet, apiPost, buildQuery } from "./http";

// Export type alias for consumers.
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

// Export type alias for consumers.
export type CardStatus = "active" | "revoked";

// Export type alias for consumers.
export type AccessCardGrant = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  locationId: string | null;
  // Field/property in this shape.
  validFrom: string;
  // Field/property in this shape.
  validUntil: string;
  // Field/property in this shape.
  location: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    number: string;
    // Field/property in this shape.
    floor: { number: number; building: { code: string; name: string } };
  // Close multi-line construct with trailing syntax.
  } | null;
};

// Export type alias for consumers.
export type AccessCard = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  cardType: CardType;
  // Field/property in this shape.
  status: CardStatus;
  // Field/property in this shape.
  label: string | null;
  // Field/property in this shape.
  employeeId: string | null;
  // Field/property in this shape.
  commandId: string;
  // Field/property in this shape.
  createdAt: string;
  // Field/property in this shape.
  employee: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    fullName: string;
    // Field/property in this shape.
    employeeNumber: string;
  // Close multi-line construct with trailing syntax.
  } | null;
  // Field/property in this shape.
  issuedBy: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    fullName: string;
    // Field/property in this shape.
    employeeNumber: string;
  };
  // Field/property in this shape.
  grants: AccessCardGrant[];
};

// Export type alias for consumers.
export type CardEmployeeOption = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  fullName: string;
  // Field/property in this shape.
  employeeNumber: string;
  // Field/property in this shape.
  department: string | null;
};

/** List access cards with optional employee / status / type / search filters. */
export async function fetchCards(params?: {
  // Field/property in this shape.
  employeeId?: string;
  // Field/property in this shape.
  status?: CardStatus;
  // Field/property in this shape.
  cardType?: CardType;
  // Field/property in this shape.
  q?: string;
  // Field/property in this shape.
  staffOnly?: boolean;
// Open multi-line construct.
}): Promise<AccessCard[]> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/cards${buildQuery({
      // Field/property in this shape.
      employeeId: params?.employeeId,
      // Field/property in this shape.
      status: params?.status,
      // Field/property in this shape.
      cardType: params?.cardType,
      // Field/property in this shape.
      q: params?.q,
      // Field/property in this shape.
      staffOnly: params?.staffOnly || undefined,
    // Continue multi-line list/arguments.
    })}`,
  );
}

/** Employee picker options for issuing staff cards (optional name search). */
export async function fetchCardEmployees(
  // Field/property in this shape.
  q?: string,
// Open multi-line construct.
): Promise<CardEmployeeOption[]> {
  // Return computed result to caller.
  return apiGet(`/cards/employees${buildQuery({ q })}`);
}

/** Issue a card; generates `commandId` when the caller does not supply one. */
export async function issueCard(input: {
  // Field/property in this shape.
  cardType: CardType;
  // Field/property in this shape.
  employeeId?: string | null;
  // Field/property in this shape.
  locationId?: string | null;
  // Field/property in this shape.
  validFrom: string;
  // Field/property in this shape.
  validUntil: string;
  // Field/property in this shape.
  label?: string | null;
  // Field/property in this shape.
  commandId?: string;
// Open multi-line construct.
}): Promise<AccessCard> {
  // Return computed result to caller.
  return apiPost("/cards", {
    // Spread remaining fields/props.
    ...input,
    // Field/property in this shape.
    commandId: input.commandId ?? crypto.randomUUID(),
  });
}

/** Soft-revoke a card; returns the updated row with status `revoked`. */
export async function revokeCard(id: string): Promise<AccessCard> {
  // Return computed result to caller.
  return apiPost(`/cards/${id}/revoke`);
}
