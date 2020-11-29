import Snoowrap from 'snoowrap';
import { SubmissionStream } from 'snoostorm';
import { SubmissionQueue } from './SubmissionQueue';
import { getBase64Data, translate, uploadImage, tryParseUrl } from './translationUtils';

const client = new Snoowrap({
	userAgent: 'reddit-bot-ichigo-reader',
	clientId: '[REDACTED]',
	clientSecret: '[REDACTED]',
	refreshToken: '[REDACTED]'
});
const pollTimeMs = 10 * 60 * 1000; // 10 minutes.
const streamConfig = {
	subreddit: 'testingground4bots',
	results: 25,
	frequency: pollTimeMs
};

const submissionAgeLimitMs = 24 * 60 * 60 * 1000; // 1 day.
const queue = new SubmissionQueue(submissionAgeLimitMs);
const submissionListener = new SubmissionStream(client, streamConfig);

submissionListener.on('item', submission => {
	queue.add(submission);
});

const timeoutMs = 20 * 60 * 1000; // 20 minutes.
setInterval(processQueue, timeoutMs);

async function processQueue() {
	queue.clearExpired();
	await queue.refresh();

	for (const submission of queue) {
		const result = await processQueueItem(submission);
		switch (result) {
			case 'retryLater':
				break;
			case 'removeFromQueue':
				queue.remove(submission);
				break;
			default:
				throw new Error(`Unexpected result: ${result}`);
		}
	}
}

const supportedHostnames = new Set([
	'i.redd.it',
	'preview.redd.it',
	'external-preview.redd.it',
	'i.imgur.com'
]);

async function processQueueItem(
	submission: Snoowrap.Submission
): Promise<'retryLater' | 'removeFromQueue'> {
	const url = tryParseUrl(submission.url);
	const isSupportedUrl = supportedHostnames.has(url?.hostname);
	if (!isSupportedUrl) {
		return 'removeFromQueue';
	}

	// Avoid translating images with a low number of views.
	const minimumApplicableViewCount = 100;
	if (submission.view_count < minimumApplicableViewCount) {
		return 'retryLater';
	}

	// This shouldn't occur because submissions should be removed from the queue after processing.
	// But we really do not want to spam reddit.
	const hasAlreadyTranslated = await checkHasCommentedOn(submission);
	if (hasAlreadyTranslated) {
		return 'removeFromQueue';
	}

	const image = await getBase64Data(url);

	// Can happen if image was deleted, image link was deleted, website is down, etc.
	// Return instead of throwing because it is not an exceptional event.
	if (image == null) {
		return 'removeFromQueue';
	}

	// Avoid translating small images.
	if (image.height < 375 || image.width < 375) {
		return 'removeFromQueue';
	}

	let translatedImage: string | null;
	try {
		translatedImage = await translate(image.base64Data);
	} catch (error) {
		console.log(error);
		return 'removeFromQueue';
	}

	if (translatedImage == null) {
		return 'removeFromQueue';
	}

	const imageUrl = await uploadImage(translatedImage);
	if (imageUrl == null) {
		return 'removeFromQueue';
	}

	submission.reply(`[Translated version](${imageUrl})`);
	return 'removeFromQueue';
}

const botUsername = 'IchigoReader';

async function checkHasCommentedOn(submission: Snoowrap.Submission) {
	// fetchAll can apparently hit the rate limit very fast.
	// The bot should not be used on subreddits with lots of comments.
	const comments = await submission.comments.fetchAll({ skipReplies: true, amount: 100 });
	return comments.some(reply => reply.author.name === botUsername);
}
