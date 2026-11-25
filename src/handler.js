import { validateBasicAuth, unauthorizedResponse } from './utils/auth.js';
import { parseQueryParams } from './utils/query.js';
import { findZoneId, getDnsRecord, updateDnsRecord, createDnsRecord } from './utils/cloudflare.js';
import { mergeRecord, recordsAreEqual, resolveRecordType } from './utils/dns.js';
import { responseJSON, responseError } from './utils/response.js';

export async function handleRequest(request, env, ctx) {
	if (!validateBasicAuth(request, env)) {
		return unauthorizedResponse();
	}

	try {
		const { hostname, ip, overrides } = parseQueryParams(request);
		const type = resolveRecordType(ip, overrides.type);
		const apiToken = env.CLOUDFLARE_API_TOKEN;

		const zoneId = await findZoneId(hostname, apiToken);
		if (!zoneId) return responseError(`Zone not found for ${hostname}`, 404);

		const existingRecord = await getDnsRecord(zoneId, hostname, type, apiToken);
		const finalRecord = mergeRecord(existingRecord, hostname, ip, { ...overrides, type });

		if (recordsAreEqual(existingRecord, finalRecord)) {
			return new Response('Record unchanged', { status: 200 });
		}

		const result = existingRecord
			? await updateDnsRecord(zoneId, existingRecord.id, finalRecord, apiToken)
			: await createDnsRecord(zoneId, finalRecord, apiToken);

		return responseJSON(result);
	} catch (err) {
		return responseError(`Error: ${err.message}`, 500);
	}
}
