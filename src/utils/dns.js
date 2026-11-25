const SUPPORTED_TYPES = ['A', 'AAAA', 'CNAME'];

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-f:.]+$/i;

/**
 * Possible zone names for a hostname, most specific first, so a delegated
 * subdomain zone wins over its parent and multi-part TLDs (co.uk) work.
 * e.g. "home.example.co.uk" -> ["home.example.co.uk", "example.co.uk", "co.uk"]
 */
export function zoneCandidates(hostname) {
	const labels = hostname.split('.');
	const candidates = [];
	for (let i = 0; i <= labels.length - 2; i++) {
		candidates.push(labels.slice(i).join('.'));
	}
	return candidates;
}

/**
 * Decide which record type to manage. An explicit type wins (A, AAAA or CNAME only);
 * otherwise it is inferred from the content so IPv4 and IPv6 updates never touch each other's record.
 */
export function resolveRecordType(content, requestedType) {
	if (requestedType) {
		const type = requestedType.toUpperCase();
		if (!SUPPORTED_TYPES.includes(type)) {
			throw new Error(`Unsupported record type: ${requestedType} (expected A, AAAA or CNAME)`);
		}
		return type;
	}

	if (IPV4.test(content)) return 'A';
	if (content.includes(':') && IPV6.test(content)) return 'AAAA';

	throw new Error(`Cannot infer record type from "${content}"; pass type=CNAME for hostname targets`);
}

export function mergeRecord(existing, hostname, ip, overrides) {
	return {
		type: overrides.type || existing?.type || 'A',
		name: hostname,
		content: ip,
		ttl: overrides.ttl ?? existing?.ttl ?? 1,
		proxied: overrides.proxied ?? existing?.proxied ?? true,
	};
}

export function recordsAreEqual(existing, current) {
	if (!existing) return false;
	return (
		existing.type === current.type &&
		existing.content === current.content &&
		existing.ttl === current.ttl &&
		existing.proxied === current.proxied
	);
}
