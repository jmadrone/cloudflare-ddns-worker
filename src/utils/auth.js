const encoder = new TextEncoder();

// Constant-time string comparison. Leaks only whether the lengths differ.
function timingSafeEqualString(a, b) {
	const aBytes = encoder.encode(a);
	const bBytes = encoder.encode(b);
	if (aBytes.byteLength !== bBytes.byteLength) {
		// Still do the work so a length mismatch takes about as long as a value mismatch.
		return !crypto.subtle.timingSafeEqual(aBytes, aBytes);
	}
	return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

// atob() yields one char per byte; decode those bytes as UTF-8 so non-ASCII credentials compare correctly.
function decodeBase64Utf8(encoded) {
	const binary = atob(encoded);
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

export function validateBasicAuth(request, env) {
	const expectedUser = env.BASIC_AUTH_USER;
	const expectedPass = env.BASIC_AUTH_PASS;

	// Fail closed: if credentials aren't configured, nobody gets in.
	if (!expectedUser || !expectedPass) {
		return false;
	}

	const header = request.headers.get('Authorization');
	if (!header || !header.startsWith('Basic ')) {
		return false;
	}

	let decoded;
	try {
		decoded = decodeBase64Utf8(header.slice(6));
	} catch {
		return false;
	}

	// Per RFC 7617 the user-id cannot contain a colon, but the password can, so split on the first one only.
	const separator = decoded.indexOf(':');
	if (separator === -1) {
		return false;
	}

	const user = decoded.slice(0, separator);
	const pass = decoded.slice(separator + 1);

	// Evaluate both comparisons so timing doesn't reveal which one failed.
	const userOk = timingSafeEqualString(user, expectedUser);
	const passOk = timingSafeEqualString(pass, expectedPass);
	return userOk && passOk;
}

export function unauthorizedResponse() {
	return new Response('Unauthorized', {
		status: 401,
		headers: {
			'WWW-Authenticate': 'Basic realm="Cloudflare DDNS Worker"',
		},
	});
}
