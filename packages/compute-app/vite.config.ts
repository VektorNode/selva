import { createViteConfig } from '@selva/config/vite';
import { execSync } from 'child_process';

function getGitInfo() {
	try {
		const hash = execSync('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'pipe'] })
			.toString()
			.trim();
		const shortHash = hash.slice(0, 7);
		const message = execSync('git log -1 --format=%s', { stdio: ['pipe', 'pipe', 'pipe'] })
			.toString()
			.trim();
		const date = execSync('git log -1 --format=%ci', { stdio: ['pipe', 'pipe', 'pipe'] })
			.toString()
			.trim();
		return { hash, shortHash, message, date };
	} catch {
		return { hash: 'unknown', shortHash: 'unknown', message: 'unknown', date: 'unknown' };
	}
}

const git = getGitInfo();

export default createViteConfig({
	define: {
		__GIT_HASH__: JSON.stringify(git.hash),
		__GIT_SHORT_HASH__: JSON.stringify(git.shortHash),
		__GIT_MESSAGE__: JSON.stringify(git.message),
		__GIT_DATE__: JSON.stringify(git.date)
	}
});
