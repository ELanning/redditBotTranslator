import fetch from 'node-fetch';
import imgur from 'imgur';
import { Image, createCanvas } from 'canvas';

imgur.setClientId('[REDACTED]');
// This might not be necessary according to the docs, but can't hurt.
imgur.setCredentials('[REDACTED]', '[REDACTED]', '[REDACTED]');

type ImageBase64 = string; // Eg 'data:image/png;base64,iVBORw0KGgo...'

interface TranslationResult {
	originalLanguage: string;
	translatedText: string;
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

enum StatusCode {
	Ok = 200
}

// Returns null if the image could not be uploaded.
export async function uploadImage(image: ImageBase64): Promise<URL | null> {
	const formattedBase64 = image.replace(/^data:.*;base64,/g, '');
	return new Promise(resolve =>
		imgur
			.uploadBase64(formattedBase64)
			.then(function (json) {
				const url = tryParseUrl(json.data.link);
				resolve(url);
			})
			.catch(function () {
				// Imgur can be down due to maintenance, high load, or other reasons.
				// It is not an exceptional event, so simply return null.
				resolve(null);
			})
	);
}

// Returns null if url is malformed.
export function tryParseUrl(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

// Returns null if the image cannot be translated.
export async function translate(image: ImageBase64): Promise<ImageBase64 | null> {
	const translationRequest = await fetch('http://localhost:3001/translate', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		// API supports multiple images, but only one is necessary for now.
		body: JSON.stringify({ base64Images: [image], apiKey: '[REDACTED]' })
	});

	if (translationRequest.status !== StatusCode.Ok) {
		throw new Error(`translation request failed with:\n${JSON.stringify(translationRequest)}`);
	}

	const translations = (await translationRequest.json()).images[0] as TranslationResult[];
	const isAllSupported = translations.every(checkIsSupportedLanguage);
	if (translations.length === 0 || !isAllSupported) {
		return null;
	}

	const translatedImage = await overlayTranslations(image, translations);
	return translatedImage;
}

// Returns null if the base64 data could not be retrieved.
export function getBase64Data(
	imageUrl: URL
): Promise<{ base64Data: ImageBase64; width: number; height: number } | null> {
	return new Promise(resolve => {
		const image = new Image();
		image.onload = function () {
			const canvas = createCanvas(image.width, image.height);
			const context = canvas.getContext('2d');
			context.drawImage(
				image,
				0,
				0,
				image.width,
				image.height,
				0,
				0,
				image.width,
				image.height
			);
			resolve({
				base64Data: canvas.toDataURL('image/png'),
				height: image.height,
				width: image.width
			});
		};

		// Handle various things that can go wrong when loading an image.
		// This includes network issues, dead links, etc.
		function onFailed() {
			resolve(null);
		}
		image.onerror = onFailed;

		image.src = imageUrl.toString();
	});
}

function checkIsSupportedLanguage(translation: TranslationResult) {
	const supportedLanguages = ['jp', 'kr', 'cn'];
	return supportedLanguages.includes(translation.originalLanguage);
}

function overlayTranslations(
	imageBase64: string,
	translations: TranslationResult[]
): Promise<ImageBase64> {
	return new Promise(resolve => {
		const image = new Image();
		image.onload = function () {
			const canvas = createCanvas(image.width, image.height);
			const context = canvas.getContext('2d');
			context.drawImage(
				image,
				0,
				0,
				image.width,
				image.height,
				0,
				0,
				image.width,
				image.height
			);

			const filteredTranslations = translations.filter(x => x.translatedText.trim() !== '');

			// Draw text bubble as a rounded rectangle.
			for (const translation of filteredTranslations) {
				const width = translation.maxX - translation.minX;
				const height = translation.maxY - translation.minY;
				const radius = 10; // Roughly 10px.
				const backgroundColor = 'white';

				drawRectangle(
					context,
					translation.minX,
					translation.minY,
					width,
					height,
					radius,
					backgroundColor
				);
			}

			// Write text on the bubbles.
			for (const translation of filteredTranslations) {
				const maxLineWidth = translation.maxX - translation.minX;
				const maxHeight = translation.maxY - translation.minY;
				const startY = translation.minY;
				const maxFontSizePx = 300; // Arbitrarily large starting font.

				fitText(
					context,
					translation.translatedText,
					translation.minX,
					startY,
					maxHeight,
					maxLineWidth,
					maxFontSizePx
				);
			}

			resolve(canvas.toDataURL('image/png'));
		};

		image.src = imageBase64;
	});
}

// Modified from Grumdrig's StackOverflow response.
function drawRectangle(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
	backgroundColor?: string
) {
	if (width < 2 * radius) {
		radius = width / 2;
	}
	if (height < 2 * radius) {
		radius = height / 2;
	}

	context.beginPath();
	context.moveTo(x + radius, y);
	context.arcTo(x + width, y, x + width, y + height, radius);
	context.arcTo(x + width, y + height, x, y + height, radius);
	context.arcTo(x, y + height, x, y, radius);
	context.arcTo(x, y, x + width, y, radius);
	context.closePath();

	if (backgroundColor) {
		context.fillStyle = backgroundColor;
		context.fill();
	}
}

function fitText(
	context: CanvasRenderingContext2D,
	text: string,
	offsetX: number,
	startY: number,
	maxHeight: number,
	maxLineWidth: number,
	maxFontSizePx: number
) {
	if (text === '') {
		return;
	}

	context.font = `${Math.floor(maxFontSizePx)}px Bangers`;
	context.fillStyle = 'black';
	const lineHeight = Math.floor(maxFontSizePx) * 1.375;
	const lines: { offsetY: number; text: string; maxFontSizePx?: number }[] = [];
	const words = text.split(' ');
	let currentLine = words.shift() as string; // Pop the first element.
	let offsetY = startY + lineHeight; // Add lineHeight to normalize fitText coordinates.

	// Edge case, best handled separately.
	const isOneWordText = words.length === 0;
	if (isOneWordText) {
		const { width: singleWordWidth } = context.measureText(currentLine);
		if (singleWordWidth > maxLineWidth) {
			fitText(context, text, offsetX, startY, maxHeight, maxLineWidth, 0.75 * maxFontSizePx);
			return;
		} else {
			context.fillText(currentLine, offsetX, offsetY);
			return;
		}
	}

	for (const word of words) {
		const { width: singleWordWidth } = context.measureText(word);
		// Exceeded max line width with a single word. Retry with a different font size.
		if (singleWordWidth > maxLineWidth) {
			fitText(context, text, offsetX, startY, maxHeight, maxLineWidth, 0.75 * maxFontSizePx);
			return;
		}

		const nextLine = `${currentLine} ${word}`;
		const { width: nextLineWidth } = context.measureText(nextLine);
		if (nextLineWidth < maxLineWidth) {
			currentLine = nextLine;
		} else {
			// Start a new line.
			lines.push({ offsetY: offsetY, text: currentLine, maxFontSizePx });
			currentLine = word;
			offsetY += lineHeight;
		}

		// Exceeded max height. Retry with a different font size.
		if (offsetY > maxHeight + startY) {
			fitText(context, text, offsetX, startY, maxHeight, maxLineWidth, 0.75 * maxFontSizePx);
			return;
		}
	}

	const lastLine = currentLine.trim();
	if (lastLine !== '') {
		lines.push({ offsetY: offsetY, text: lastLine });
	}

	for (const line of lines) {
		context.fillText(line.text, offsetX, line.offsetY);
	}
}
