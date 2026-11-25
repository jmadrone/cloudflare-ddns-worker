import { describe, it, expect } from 'vitest';
import { validateBasicAuth, unauthorizedResponse } from '../src/utils/auth.js';

function createRequestWithAuthHeader(headerValue) {
	return new Request('https://example.com', {
		headers: {
			Authorization: headerValue,
		},
	});
}

describe('validateBasicAuth', () => {
	const env = {
		BASIC_AUTH_USER: 'user',
		BASIC_AUTH_PASS: 'pass',
	};

	it('returns true for correct credentials', () => {
		const creds = btoa('user:pass');
		const req = createRequestWithAuthHeader(`Basic ${creds}`);
		expect(validateBasicAuth(req, env)).toBe(true);
	});

	it('returns false for incorrect username', () => {
		const creds = btoa('wrong:pass');
		const req = createRequestWithAuthHeader(`Basic ${creds}`);
		expect(validateBasicAuth(req, env)).toBe(false);
	});

	it('returns false for incorrect password', () => {
		const creds = btoa('user:wrong');
		const req = createRequestWithAuthHeader(`Basic ${creds}`);
		expect(validateBasicAuth(req, env)).toBe(false);
	});

	it('returns false when Authorization header is missing', () => {
		const req = new Request('https://example.com');
		expect(validateBasicAuth(req, env)).toBe(false);
	});

	it('returns false when Authorization header is not Basic', () => {
		const req = createRequestWithAuthHeader('Bearer sometoken');
		expect(validateBasicAuth(req, env)).toBe(false);
	});

	it('returns false for malformed base64 string', () => {
		const req = createRequestWithAuthHeader('Basic not-base64-@@@');
		expect(validateBasicAuth(req, env)).toBe(false);
	});

	it('returns false if base64 decodes but has wrong format (no colon)', () => {
		const creds = btoa('userpass'); // no colon
		const req = createRequestWithAuthHeader(`Basic ${creds}`);
		expect(validateBasicAuth(req, env)).toBe(false);
	});

	it('rejects everything when BASIC_AUTH_PASS is not configured', () => {
		const envNoPass = { BASIC_AUTH_USER: 'user' };
		// Previously "user" (no colon) left pass undefined, which matched the unset secret.
		expect(validateBasicAuth(createRequestWithAuthHeader(`Basic ${btoa('user')}`), envNoPass)).toBe(false);
		expect(validateBasicAuth(createRequestWithAuthHeader(`Basic ${btoa('user:')}`), envNoPass)).toBe(false);
		expect(validateBasicAuth(createRequestWithAuthHeader(`Basic ${btoa('user:anything')}`), envNoPass)).toBe(false);
	});

	it('rejects everything when BASIC_AUTH_USER is not configured', () => {
		const envNoUser = { BASIC_AUTH_PASS: 'pass' };
		expect(validateBasicAuth(createRequestWithAuthHeader(`Basic ${btoa(':pass')}`), envNoUser)).toBe(false);
	});

	it('accepts a password that contains colons', () => {
		const envColon = { BASIC_AUTH_USER: 'user', BASIC_AUTH_PASS: 'a:b:c' };
		const req = createRequestWithAuthHeader(`Basic ${btoa('user:a:b:c')}`);
		expect(validateBasicAuth(req, envColon)).toBe(true);
	});

	it('treats everything after the first colon as the password', () => {
		const req = createRequestWithAuthHeader(`Basic ${btoa('user:pass:extra')}`);
		expect(validateBasicAuth(req, env)).toBe(false);
	});

	it('returns false when the password is a prefix of the real one', () => {
		const req = createRequestWithAuthHeader(`Basic ${btoa('user:pas')}`);
		expect(validateBasicAuth(req, env)).toBe(false);
	});

	it('accepts non-ASCII credentials encoded as UTF-8', () => {
		const envUnicode = { BASIC_AUTH_USER: 'usér', BASIC_AUTH_PASS: 'pässwörd🔑' };
		const bytes = new TextEncoder().encode('usér:pässwörd🔑');
		const creds = btoa(String.fromCharCode(...bytes));
		expect(validateBasicAuth(createRequestWithAuthHeader(`Basic ${creds}`), envUnicode)).toBe(true);
	});
});

describe('unauthorizedResponse', () => {
	it('returns a 401 response with WWW-Authenticate header', async () => {
		const res = unauthorizedResponse();
		expect(res.status).toBe(401);
		expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="Cloudflare DDNS Worker"');
		const body = await res.text();
		expect(body).toBe('Unauthorized');
	});
});
