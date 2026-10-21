export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? "server_error");
    this.status = status;
    this.code = body?.error ?? "server_error";
    this.body = body;
  }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: { "x-orbit-request": "1", ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: "network" });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = p => api("GET", p);
export const post = (p, b) => api("POST", p, b ?? {});
export const patch = (p, b) => api("PATCH", p, b);
export const put = (p, b) => api("PUT", p, b);
export const del = p => api("DELETE", p);

export const fileToBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(new Error("read"));
  r.readAsDataURL(file);
});
