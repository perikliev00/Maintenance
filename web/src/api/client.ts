const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type Role = "reception" | "housekeeper" | "supervisor";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  employeeId: string;
  fullName: string;
};

export type Room = {
  id: string;
  number: string;
  floor: number;
  floorName: string;
  building: string;
  buildingCode: string;
  catalogStatus: string;
  occupancy: string;
  cleaningStatus: string;
  serviceStatus: string;
  readiness: "ready" | "not_ready" | "needs_check";
  readinessReasons: string[];
  activeTask: {
    id: string;
    status: string;
    priority: string;
    version: number;
    assignee: { id: string; fullName: string; employeeNumber: string } | null;
    runningSession: {
      id: string;
      startedAt: string;
      employeeId: string;
    } | null;
  } | null;
};

type ApiError = {
  error?: string;
  message?: string;
};

function authHeaders(): HeadersInit {
  const token = getToken();
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as ApiError;
    throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export function getToken(): string | null {
  return localStorage.getItem("token");
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function clearToken() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJson<{ token: string; user: AuthUser }>(res);
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

export async function fetchRooms(): Promise<Room[]> {
  const res = await fetch(`${API_BASE}/rooms`, { headers: authHeaders() });
  return parseJson(res);
}

export async function markRoomDirty(roomId: string): Promise<Room> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/mark-dirty`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function createCleaningTask(input: {
  locationId: string;
  hotelDate: string;
  priority?: string;
  assignedEmployeeId?: string;
}) {
  const res = await fetch(`${API_BASE}/cleaning/tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function startCleaningTask(taskId: string, expectedVersion?: number) {
  const res = await fetch(`${API_BASE}/cleaning/tasks/${taskId}/start`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      expectedVersion,
    }),
  });
  return parseJson(res);
}

export async function completeCleaningSession(sessionId: string) {
  const res = await fetch(`${API_BASE}/cleaning/sessions/${sessionId}/complete`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ commandId: crypto.randomUUID() }),
  });
  return parseJson(res);
}

export async function fetchHousekeepers() {
  const res = await fetch(`${API_BASE}/cleaning/employees/housekeepers`, {
    headers: authHeaders(),
  });
  return parseJson<Array<{ id: string; fullName: string; employeeNumber: string }>>(res);
}

export function todayHotelDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
