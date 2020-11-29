import Snoowrap from 'snoowrap';

export class SubmissionQueue {
	private submissions: Snoowrap.Submission[];
	private submissionAgeLimitMs: number;

	constructor(submissionAgeLimitMs: number) {
		this.submissions = [];
		this.submissionAgeLimitMs = submissionAgeLimitMs;
	}

	add = (submission: Snoowrap.Submission): void => {
		this.submissions.push(submission);
	};

	remove = (submission: Snoowrap.Submission): void => {
		const indexToRemove = this.submissions.findIndex(item => item.id == submission.id);
		if (indexToRemove !== -1) {
			this.submissions.splice(indexToRemove, 1);
		}
	};

	clearExpired = (): void => {
		const nowMs = Date.now();

		for (let i = 0; i < this.submissions.length; i++) {
			const createdUtcMs = 1000 * this.submissions[i].created_utc; // created_utc is in seconds since the epoch.
			const isExpiredSubmission = nowMs - createdUtcMs > this.submissionAgeLimitMs;

			if (isExpiredSubmission) {
				this.submissions.splice(i, 1);
			}
		}
	};

	refresh = async (): Promise<void> => {
		const refreshPromises = this.submissions.map(submission => submission.refresh());
		await Promise.all(refreshPromises);
	};

	[Symbol.iterator]() {
		return this.submissions.values();
	}
}
