const ownerChangeQueues = new Map<string, Promise<unknown>>();

/**
 * Runs one org's or project's member changes one at a time. The sole-owner check
 * reads, then writes: two owners acting on each other at once would each see the
 * other as the survivor and leave none. Per process only; replicas still need an
 * atomic store write to close it.
 */
export function serializeOwnerChanges<T>(id: string, run: () => Promise<T>): Promise<T> {
	const previous = ownerChangeQueues.get(id) ?? Promise.resolve();
	const next = previous.catch(() => {}).then(run);
	const tail = next.catch(() => {});
	ownerChangeQueues.set(id, tail);
	void tail.then(() => {
		if (ownerChangeQueues.get(id) === tail) ownerChangeQueues.delete(id);
	});
	return next;
}
