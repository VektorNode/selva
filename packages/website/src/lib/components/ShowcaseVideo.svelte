<script lang="ts">
	interface Props {
		/** File name in /showcase without extension: `<name>.mp4` plays, `<name>.webp` is its first frame. */
		name: string;
		label: string;
	}

	let { name, label }: Props = $props();

	let video = $state<HTMLVideoElement>();
	let reducedMotion = $state(false);

	// Plays only while on screen, and the file is not fetched before that: six loops on one
	// page would otherwise all download and decode at once.
	$effect(() => {
		const element = video;
		if (!element) return;
		reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reducedMotion) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) element.play().catch(() => {});
				else element.pause();
			},
			{ threshold: 0.35 }
		);
		observer.observe(element);
		return () => observer.disconnect();
	});
</script>

<video
	bind:this={video}
	src="/showcase/{name}.mp4"
	poster="/showcase/{name}.webp"
	aria-label={label}
	width="1600"
	height="900"
	muted
	loop
	playsinline
	preload="none"
	controls={reducedMotion}
	class="border-border w-full rounded-lg border"
></video>
