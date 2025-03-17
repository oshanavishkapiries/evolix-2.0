import { API_URL } from '../config';

interface ExtractorMetadata {
  Referer?: string;
  Origin?: string;
}

export async function getVideoExtractorScript(provider: string): Promise<string> {

  console.log("Fetching video extractor script:", provider);
  try {
      const response = await fetch(`${API_URL}/extractors/${provider}/video`);
      if (!response.ok) {
          throw new Error('Failed to fetch video extractor script');
      }
      const script = await response.text();
      return script;
  } catch (error) {
      console.error('Error fetching video extractor script:', error);
      throw error;
  }
}

export async function getMetadata(provider: string): Promise<ExtractorMetadata> {
  try {
    const response = await fetch(`${API_URL}/extractors/${provider}/metadata`);

    if (!response.ok) {
      throw new Error('Failed to fetch metadata');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching metadata:', error);
    return {};
  }
} 