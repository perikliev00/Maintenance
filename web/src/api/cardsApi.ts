/** Access-card issue / revoke and employee picker for the Cards panel. */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type CardType =
  | "guest"
  | "housekeeper"
  | "maintenance"
  | "manager"
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
  // Optional query filters; empty → full list (server-scoped).
  const search = new URLSearchParams();
  // Branch: conditional gate.
  if (params?.employeeId) search.set("employeeId", params.employeeId);
  // Branch: conditional gate.
  if (params?.status) search.set("status", params.status);
  // Branch: conditional gate.
  if (params?.cardType) search.set("cardType", params.cardType);
  // Branch: conditional gate.
  if (params?.q) search.set("q", params.q);
  // Branch: conditional gate.
  if (params?.staffOnly) search.set("staffOnly", "true");
  // Optional query suffix.
  const qs = search.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/cards${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Employee picker options for issuing staff cards (optional name search). */
export async function fetchCardEmployees(
  q?: string,
): Promise<CardEmployeeOption[]> {
  const search = new URLSearchParams();
  // Branch: conditional gate.
  if (q) search.set("q", q);
  // Optional query suffix.
  const qs = search.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(
    `${API_BASE}/cards/employees${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  // Return value / early exit.
  return parseJson(res);
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
  // Idempotency: client UUID when the UI did not pre-assign a command id.
  const res = await apiFetch(`${API_BASE}/cards`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({
      ...input,
      commandId: input.commandId ?? crypto.randomUUID(),
    }),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Soft-revoke a card; returns the updated row with status `revoked`. */
export async function revokeCard(id: string): Promise<AccessCard> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/cards/${id}/revoke`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}
