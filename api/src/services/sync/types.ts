export type SyncCommand = {
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
  clientTime?: string;
};

export type SyncCommandResult = {
  commandId: string;
  status: "ok" | "conflict" | "forbidden" | "error";
  message?: string;
  code?: string;
  details?: unknown;
  data?: unknown;
};
