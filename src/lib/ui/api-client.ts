export interface ApiErrorPayload {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export interface ApiSuccessEnvelope<T> {
  ok: true;
  data: T;
  meta?: {
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface ApiFailureEnvelope {
  ok: false;
  error: ApiErrorPayload;
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiFailureEnvelope;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export async function parseApiResponse<T>(
  response: Response,
): Promise<{ data: T; meta?: ApiSuccessEnvelope<T>["meta"] }> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiClientError(
        response.status,
        "HTTP_ERROR",
        `Error HTTP ${response.status}`,
      );
    }
    throw new ApiClientError(
      response.status,
      "INVALID_JSON",
      "La respuesta del servidor no es JSON válido",
    );
  }

  const envelope = body as Partial<ApiEnvelope<T>> | null;
  if (!response.ok || !envelope || envelope.ok !== true) {
    const failure = envelope as Partial<ApiFailureEnvelope> | null;
    const code = failure?.error?.code ?? "REQUEST_FAILED";
    const message =
      failure?.error?.message ?? `Error en la solicitud (${response.status})`;
    throw new ApiClientError(
      response.status,
      code,
      message,
      failure?.error?.fieldErrors,
    );
  }

  return {
    data: envelope.data as T,
    meta: envelope.meta,
  };
}

export async function apiFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T; meta?: ApiSuccessEnvelope<T>["meta"] }> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  return parseApiResponse<T>(response);
}
