import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRequest } from '../src/handler.js';

global.fetch = vi.fn();

function makeAuthedRequest(query, username = 'user', password = 'pass') {
	const creds = btoa(`${username}:${password}`);
	const headers = new Headers({
		Authorization: `Basic ${creds}`,
	});
	return new Request(`https://example.com/update?${query}`, { headers });
}

const env = {
	BASIC_AUTH_USER: 'user',
	BASIC_AUTH_PASS: 'pass',
	CLOUDFLARE_API_TOKEN: 'test-token',
};

const json = (body, ok = true) => ({ ok, json: async () => body });

/**
 * Minimal fake of the Cloudflare API endpoints the worker uses.
 * zones:   { 'example.com': 'zone-id' }
 * records: [{ id, zoneId, name, type, content, ttl, proxied }]
 * Every request is recorded in `calls` as { method, path, params, body }.
 */
function fakeCloudflare({ zones = {}, records = [] } = {}) {
	const calls = [];
	fetch.mockImplementation(async (input, init = {}) => {
		const url = new URL(input);
		const path = url.pathname.replace('/client/v4/', '');
		const method = init.method || 'GET';
		const body = init.body ? JSON.parse(init.body) : null;
		calls.push({ method, path, params: url.searchParams, body });

		if (method === 'GET' && path === 'zones') {
			const id = zones[url.searchParams.get('name')];
			return json({ result: id ? [{ id }] : [] });
		}

		let m;
		if (method === 'GET' && (m = path.match(/^zones\/([^/]+)\/dns_records$/))) {
			const name = url.searchParams.get('name');
			const type = url.searchParams.get('type');
			const result = records.filter((r) => r.zoneId === m[1] && r.name === name && (!type || r.type === type));
			return json({ result });
		}
		if (method === 'PUT' && (m = path.match(/^zones\/[^/]+\/dns_records\/([^/]+)$/))) {
			return json({ result: { id: m[1], ...body } });
		}
		if (method === 'POST' && /^zones\/[^/]+\/dns_records$/.test(path)) {
			return json({ result: { id: 'new-record', ...body } });
		}
		throw new Error(`Unexpected request: ${method} ${url}`);
	});
	return calls;
}

const writes = (calls) => calls.filter((c) => c.method !== 'GET');

describe('handleRequest', () => {
	beforeEach(() => {
		fetch.mockReset();
	});

	describe('auth', () => {
		it('returns 401 if auth is missing', async () => {
			const req = new Request('https://example.com/update?hostname=a.com&ip=1.1.1.1');
			const res = await handleRequest(req, env);
			expect(res.status).toBe(401);
			expect(await res.text()).toBe('Unauthorized');
		});

		it('returns 401 if auth is invalid', async () => {
			const req = makeAuthedRequest('hostname=a.com&ip=1.1.1.1', 'invalid', 'wrong');
			const res = await handleRequest(req, env);
			expect(res.status).toBe(401);
			expect(await res.text()).toBe('Unauthorized');
		});

		it('returns 401 without calling Cloudflare when the password secret is unset', async () => {
			const req = new Request('https://example.com/update?hostname=home.example.com&ip=1.2.3.4', {
				headers: { Authorization: `Basic ${btoa('user')}` },
			});
			const res = await handleRequest(req, { BASIC_AUTH_USER: 'user', CLOUDFLARE_API_TOKEN: 't' });
			expect(res.status).toBe(401);
			expect(fetch).not.toHaveBeenCalled();
		});
	});

	describe('basic flow', () => {
		it('returns 404 if no zone matches the hostname', async () => {
			fakeCloudflare({ zones: {} });
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=1.2.3.4'), env);
			expect(res.status).toBe(404);
			expect(await res.text()).toMatch(/Zone not found for home\.example\.com/);
		});

		it('returns 500 if an unexpected error is thrown', async () => {
			fetch.mockRejectedValueOnce(new Error('fail'));
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=1.2.3.4'), env);
			expect(res.status).toBe(500);
			expect(await res.text()).toMatch(/Error: fail/);
		});

		it('returns the Cloudflare error message when the API rejects a call', async () => {
			fetch.mockResolvedValueOnce(json({ errors: [{ message: 'Invalid API token' }] }, false));
			const res = await handleRequest(makeAuthedRequest('hostname=example.com&ip=1.2.3.4'), env);
			expect(res.status).toBe(500);
			expect(await res.text()).toMatch(/Invalid API token/);
		});

		it('creates a new record if none exists', async () => {
			const calls = fakeCloudflare({ zones: { 'example.com': 'zone123' } });
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=1.2.3.4'), env);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.result).toMatchObject({ name: 'home.example.com', type: 'A', content: '1.2.3.4' });
			expect(writes(calls)).toHaveLength(1);
			expect(writes(calls)[0].method).toBe('POST');
		});

		it('updates an existing record with new IP', async () => {
			const calls = fakeCloudflare({
				zones: { 'example.com': 'zone123' },
				records: [{ id: 'record123', zoneId: 'zone123', name: 'home.example.com', type: 'A', content: '5.5.5.5', ttl: 1, proxied: true }],
			});
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=1.2.3.4'), env);
			expect(res.status).toBe(200);
			expect((await res.json()).result.content).toBe('1.2.3.4');
			expect(writes(calls)).toMatchObject([{ method: 'PUT', path: 'zones/zone123/dns_records/record123' }]);
		});

		it('returns 200 if nothing changes', async () => {
			const calls = fakeCloudflare({
				zones: { 'example.com': 'zone123' },
				records: [{ id: 'record123', zoneId: 'zone123', name: 'home.example.com', type: 'A', content: '1.2.3.4', ttl: 1, proxied: true }],
			});
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=1.2.3.4'), env);
			expect(res.status).toBe(200);
			expect(await res.text()).toBe('Record unchanged');
			expect(writes(calls)).toHaveLength(0);
		});

		it('returns 500 for missing query params', async () => {
			const res = await handleRequest(makeAuthedRequest('hostname=missing.com'), env);
			expect(res.status).toBe(500);
			expect(await res.text()).toMatch(/Missing hostname or ip/);
		});

		it('returns 500 for empty query values', async () => {
			const res = await handleRequest(makeAuthedRequest('hostname=&ip='), env);
			expect(res.status).toBe(500);
			expect(await res.text()).toMatch(/Missing hostname or ip/);
		});
	});

	describe('record type handling', () => {
		const dualStack = () => [
			{ id: 'rec-a', zoneId: 'zone123', name: 'home.example.com', type: 'A', content: '5.5.5.5', ttl: 1, proxied: false },
			{ id: 'rec-aaaa', zoneId: 'zone123', name: 'home.example.com', type: 'AAAA', content: '2001:db8::5', ttl: 1, proxied: false },
		];

		it('updates only the AAAA record for an IPv6 address on a dual-stack name', async () => {
			const calls = fakeCloudflare({ zones: { 'example.com': 'zone123' }, records: dualStack() });
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=2001:db8::9'), env);
			expect(res.status).toBe(200);
			expect(writes(calls)).toMatchObject([
				{ method: 'PUT', path: 'zones/zone123/dns_records/rec-aaaa', body: { type: 'AAAA', content: '2001:db8::9' } },
			]);
		});

		it('updates only the A record for an IPv4 address on a dual-stack name', async () => {
			const calls = fakeCloudflare({ zones: { 'example.com': 'zone123' }, records: dualStack() });
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=1.2.3.4'), env);
			expect(res.status).toBe(200);
			expect(writes(calls)).toMatchObject([
				{ method: 'PUT', path: 'zones/zone123/dns_records/rec-a', body: { type: 'A', content: '1.2.3.4' } },
			]);
		});

		it('looks up records filtered by the resolved type', async () => {
			const calls = fakeCloudflare({ zones: { 'example.com': 'zone123' } });
			await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=2001:db8::1'), env);
			const lookup = calls.find((c) => c.path === 'zones/zone123/dns_records' && c.method === 'GET');
			expect(lookup.params.get('type')).toBe('AAAA');
		});

		it('never overwrites a TXT record at the same name', async () => {
			const calls = fakeCloudflare({
				zones: { 'example.com': 'zone123' },
				records: [
					{ id: 'rec-txt', zoneId: 'zone123', name: 'home.example.com', type: 'TXT', content: 'v=spf1 -all', ttl: 1, proxied: false },
				],
			});
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=1.2.3.4'), env);
			expect(res.status).toBe(200);
			expect(writes(calls)).toHaveLength(1);
			expect(writes(calls)[0]).toMatchObject({ method: 'POST', body: { type: 'A', content: '1.2.3.4' } });
		});

		it('updates a CNAME when type=CNAME is passed', async () => {
			const calls = fakeCloudflare({
				zones: { 'example.com': 'zone123' },
				records: [
					{
						id: 'rec-cname',
						zoneId: 'zone123',
						name: 'home.example.com',
						type: 'CNAME',
						content: 'old.example.net',
						ttl: 1,
						proxied: false,
					},
				],
			});
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=new.example.net&type=CNAME'), env);
			expect(res.status).toBe(200);
			expect(writes(calls)).toMatchObject([
				{ method: 'PUT', path: 'zones/zone123/dns_records/rec-cname', body: { type: 'CNAME', content: 'new.example.net' } },
			]);
		});

		it('rejects unsupported record types without writing anything', async () => {
			const calls = fakeCloudflare({ zones: { 'example.com': 'zone123' } });
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=1.2.3.4&type=TXT'), env);
			expect(res.status).toBe(500);
			expect(await res.text()).toMatch(/Unsupported record type: TXT/);
			expect(calls).toHaveLength(0);
		});

		it('rejects non-IP content when no type is given', async () => {
			const calls = fakeCloudflare({ zones: { 'example.com': 'zone123' } });
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.com&ip=not-an-ip'), env);
			expect(res.status).toBe(500);
			expect(await res.text()).toMatch(/Cannot infer record type/);
			expect(calls).toHaveLength(0);
		});
	});

	describe('zone resolution', () => {
		it('finds zones under multi-part TLDs', async () => {
			const calls = fakeCloudflare({ zones: { 'example.co.uk': 'zone-uk' } });
			const res = await handleRequest(makeAuthedRequest('hostname=home.example.co.uk&ip=1.2.3.4'), env);
			expect(res.status).toBe(200);
			expect(writes(calls)[0].path).toBe('zones/zone-uk/dns_records');
		});

		it('uses a delegated subdomain zone rather than its parent', async () => {
			const calls = fakeCloudflare({ zones: { 'example.com': 'zone-root', 'home.example.com': 'zone-sub' } });
			const res = await handleRequest(makeAuthedRequest('hostname=nas.home.example.com&ip=1.2.3.4'), env);
			expect(res.status).toBe(200);
			expect(writes(calls)[0].path).toBe('zones/zone-sub/dns_records');
		});

		it('handles an apex hostname', async () => {
			const calls = fakeCloudflare({ zones: { 'example.com': 'zone123' } });
			const res = await handleRequest(makeAuthedRequest('hostname=example.com&ip=1.2.3.4'), env);
			expect(res.status).toBe(200);
			expect(writes(calls)[0]).toMatchObject({ path: 'zones/zone123/dns_records', body: { name: 'example.com' } });
		});
	});
});
