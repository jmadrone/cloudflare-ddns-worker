import { getZoneId, findZoneId, getDnsRecord, updateDnsRecord, createDnsRecord } from '../src/utils/cloudflare.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

global.fetch = vi.fn();

const token = 'fake-token';

describe('cloudflare.js', () => {
	beforeEach(() => {
		fetch.mockReset();
	});

	describe('getZoneId', () => {
		it('returns zone ID when zone is found', async () => {
			fetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ result: [{ id: 'zone123' }] }),
			});

			const id = await getZoneId('example.com', token);
			expect(id).toBe('zone123');
		});

		it('returns null when no zone is found', async () => {
			fetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ result: [] }),
			});

			const id = await getZoneId('example.com', token);
			expect(id).toBeNull();
		});

		it('throws on API error', async () => {
			fetch.mockResolvedValueOnce({
				ok: false,
				json: async () => ({ errors: [{ message: 'API fail' }] }),
			});

			await expect(getZoneId('example.com', token)).rejects.toThrow('API fail');
		});
	});

	describe('findZoneId', () => {
		function mockZones(zones) {
			fetch.mockImplementation(async (input) => {
				const name = new URL(input).searchParams.get('name');
				return { ok: true, json: async () => ({ result: zones[name] ? [{ id: zones[name] }] : [] }) };
			});
		}

		it('finds the parent zone of a hostname', async () => {
			mockZones({ 'example.com': 'zone-root' });
			expect(await findZoneId('home.example.com', token)).toBe('zone-root');
		});

		it('finds zones under multi-part TLDs', async () => {
			mockZones({ 'example.co.uk': 'zone-uk' });
			expect(await findZoneId('home.example.co.uk', token)).toBe('zone-uk');
		});

		it('prefers a delegated subdomain zone over its parent', async () => {
			mockZones({ 'example.com': 'zone-root', 'home.example.com': 'zone-sub' });
			expect(await findZoneId('nas.home.example.com', token)).toBe('zone-sub');
		});

		it('returns null when no candidate zone exists', async () => {
			mockZones({});
			expect(await findZoneId('home.example.com', token)).toBeNull();
		});

		it('stops querying once a zone is found', async () => {
			mockZones({ 'home.example.com': 'zone-sub', 'example.com': 'zone-root' });
			await findZoneId('home.example.com', token);
			expect(fetch).toHaveBeenCalledTimes(1);
		});
	});

	describe('getDnsRecord', () => {
		it('returns record if found', async () => {
			const record = { id: 'rec123', content: '1.2.3.4' };

			fetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ result: [record] }),
			});

			const result = await getDnsRecord('zone123', 'home.example.com', 'A', token);
			expect(result).toEqual(record);
		});

		it('filters the lookup by name and type, URL-encoded', async () => {
			fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: [] }) });

			await getDnsRecord('zone123', 'a&type=TXT.example.com', 'AAAA', token);
			const url = new URL(fetch.mock.calls[0][0]);
			expect(url.searchParams.get('name')).toBe('a&type=TXT.example.com');
			expect(url.searchParams.getAll('type')).toEqual(['AAAA']);
		});

		it('returns null if no record is found', async () => {
			fetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ result: [] }),
			});

			const result = await getDnsRecord('zone123', 'home.example.com', 'A', token);
			expect(result).toBeNull();
		});

		it('throws on API error', async () => {
			fetch.mockResolvedValueOnce({
				ok: false,
				json: async () => ({ errors: [{ message: 'Record fetch failed' }] }),
			});

			await expect(getDnsRecord('zone123', 'host', 'A', token)).rejects.toThrow('Record fetch failed');
		});
	});

	describe('updateDnsRecord', () => {
		it('sends PUT request with body', async () => {
			const record = { content: '1.2.3.4' };

			fetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ result: { id: 'updated' } }),
			});

			const res = await updateDnsRecord('zone123', 'rec123', record, token);
			expect(res.result.id).toBe('updated');
			expect(fetch).toHaveBeenCalledWith(
				expect.stringContaining('/zones/zone123/dns_records/rec123'),
				expect.objectContaining({ method: 'PUT' }),
			);
		});
	});

	describe('createDnsRecord', () => {
		it('sends POST request with body', async () => {
			const record = { content: '1.2.3.4' };

			fetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ result: { id: 'created' } }),
			});

			const res = await createDnsRecord('zone123', record, token);
			expect(res.result.id).toBe('created');
			expect(fetch).toHaveBeenCalledWith(
				expect.stringContaining('/zones/zone123/dns_records'),
				expect.objectContaining({ method: 'POST' }),
			);
		});
	});

	describe('cfApi', () => {
		it('throws generic error if no error message returned', async () => {
			fetch.mockResolvedValueOnce({
				ok: false,
				json: async () => ({ errors: [] }),
			});

			await expect(
				getZoneId('example.com', token), // triggers cfApi internally
			).rejects.toThrow('Cloudflare API error');
		});
	});
});
