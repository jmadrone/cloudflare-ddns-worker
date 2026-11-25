import { describe, it, expect } from 'vitest';
import { zoneCandidates, resolveRecordType, mergeRecord, recordsAreEqual } from '../src/utils/dns.js';

describe('zoneCandidates', () => {
	it('lists candidate zones from most to least specific', () => {
		expect(zoneCandidates('home.example.com')).toEqual(['home.example.com', 'example.com']);
		expect(zoneCandidates('api.v1.dev.net')).toEqual(['api.v1.dev.net', 'v1.dev.net', 'dev.net']);
	});

	it('includes the registrable domain for multi-part TLDs', () => {
		expect(zoneCandidates('home.example.co.uk')).toEqual(['home.example.co.uk', 'example.co.uk', 'co.uk']);
	});

	it('handles an apex hostname', () => {
		expect(zoneCandidates('example.com')).toEqual(['example.com']);
	});

	it('returns nothing for a single label', () => {
		expect(zoneCandidates('localhost')).toEqual([]);
	});
});

describe('resolveRecordType', () => {
	it('infers A for IPv4 addresses', () => {
		expect(resolveRecordType('1.2.3.4')).toBe('A');
		expect(resolveRecordType('255.255.255.255')).toBe('A');
	});

	it('infers AAAA for IPv6 addresses', () => {
		expect(resolveRecordType('2001:db8::1')).toBe('AAAA');
		expect(resolveRecordType('::ffff:1.2.3.4')).toBe('AAAA');
	});

	it('uses an explicit type, case-insensitively', () => {
		expect(resolveRecordType('target.example.net', 'CNAME')).toBe('CNAME');
		expect(resolveRecordType('2001:db8::1', 'aaaa')).toBe('AAAA');
	});

	it('rejects unsupported types', () => {
		expect(() => resolveRecordType('1.2.3.4', 'TXT')).toThrow('Unsupported record type: TXT');
		expect(() => resolveRecordType('1.2.3.4', 'MX')).toThrow('Unsupported record type');
	});

	it('refuses to guess for content that is not an IP', () => {
		expect(() => resolveRecordType('target.example.net')).toThrow(/Cannot infer record type/);
		expect(() => resolveRecordType('999.1.1.1')).toThrow(/Cannot infer record type/);
	});
});

describe('mergeRecord', () => {
	it('merges with full overrides', () => {
		const existing = {
			type: 'A',
			ttl: 1,
			proxied: false,
		};

		const merged = mergeRecord(existing, 'home.example.com', '1.2.3.4', { type: 'AAAA', ttl: 300, proxied: true });

		expect(merged).toEqual({
			type: 'AAAA',
			name: 'home.example.com',
			content: '1.2.3.4',
			ttl: 300,
			proxied: true,
		});
	});

	it('falls back to existing values if override missing', () => {
		const existing = {
			type: 'A',
			ttl: 120,
			proxied: false,
		};

		const merged = mergeRecord(existing, 'home.example.com', '1.2.3.4', {});
		expect(merged).toEqual({
			type: 'A',
			name: 'home.example.com',
			content: '1.2.3.4',
			ttl: 120,
			proxied: false,
		});
	});

	it('uses defaults when existing is null', () => {
		const merged = mergeRecord(null, 'home.example.com', '1.2.3.4', {});
		expect(merged).toEqual({
			type: 'A',
			name: 'home.example.com',
			content: '1.2.3.4',
			ttl: 1,
			proxied: true,
		});
	});
});

describe('recordsAreEqual', () => {
	const base = {
		type: 'A',
		content: '1.2.3.4',
		ttl: 300,
		proxied: true,
	};

	it('returns true for identical records', () => {
		expect(recordsAreEqual(base, { ...base })).toBe(true);
	});

	it('returns false if existing is null', () => {
		expect(recordsAreEqual(null, base)).toBe(false);
	});

	it('returns false if type differs', () => {
		expect(recordsAreEqual({ ...base, type: 'AAAA' }, base)).toBe(false);
	});

	it('returns false if content differs', () => {
		expect(recordsAreEqual({ ...base, content: '9.9.9.9' }, base)).toBe(false);
	});

	it('returns false if ttl differs', () => {
		expect(recordsAreEqual({ ...base, ttl: 600 }, base)).toBe(false);
	});

	it('returns false if proxied differs', () => {
		expect(recordsAreEqual({ ...base, proxied: false }, base)).toBe(false);
	});
});
