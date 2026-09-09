export type NativeParameter = {
  id: string;
  name: string;
  value: number;
  label: string;
};
export type NativePlugin = { id: string; name: string };
export const nativeHost = {
  url: 'http://127.0.0.1:8765',
  token: '',
  async request(path: string, body: unknown = {}) {
    const response = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(path === '/render' ? 180000 : 30000),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        result.error ?? `Native host error (${response.status}).`,
      );
    }
    return response;
  },
  async plugins(): Promise<NativePlugin[]> {
    return (await (await this.request('/plugins')).json()) as NativePlugin[];
  },
  async parameters(id: string): Promise<NativeParameter[]> {
    return (await (
      await this.request('/parameters', { pluginId: id })
    ).json()) as NativeParameter[];
  },
};
