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

export async function fetchCards(params?: {
  employeeId?: string;
  status?: CardStatus;
  cardType?: CardType;
  q?: string;
  staffOnly?: boolean;
}): Promise<AccessCard[]> {
  const search = new URLSearchParams();
  if (params?.employeeId) search.set("employeeId", params.employeeId);
  if (params?.status) search.set("status", params.status);
  if (params?.cardType) search.set("cardType", params.cardType);
  if (params?.q) search.set("q", params.q);
  if (params?.staffOnly) search.set("staffOnly", "true");
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/cards${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchCardEmployees(
  q?: string,
): Promise<CardEmployeeOption[]> {
  const search = new URLSearchParams();
  if (q) search.set("q", q);
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/cards/employees${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export async function issueCard(input: {
  cardType: CardType;
  employeeId?: string | null;
  locationId?: string | null;
  validFrom: string;
  validUntil: string;
  label?: string | null;
  commandId?: string;
}): Promise<AccessCard> {
  const res = await apiFetch(`${API_BASE}/cards`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      ...input,
      commandId: input.commandId ?? crypto.randomUUID(),
    }),
  });
  return parseJson(res);
}

export async function revokeCard(id: string): Promise<AccessCard> {
  const res = await apiFetch(`${API_BASE}/cards/${id}/revoke`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}
