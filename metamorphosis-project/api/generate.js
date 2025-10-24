/*
 * This is your Vercel Serverless Function (your "backend").
 * It lives at '/api/generate'
 * It securely reads your Environment Variables.
 * It's the only thing that ever talks to Google.
 */

// Import the official Google Vertex AI library
const { VertexAI } = require('@google-cloud/vertexai');

export default async function handler(req, res) {
  // Set CORS headers to allow your frontend to call this
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow any origin
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle pre-flight (OPTIONS) requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // --- Initialize Google AI ---
  // Read the secure credentials from Vercel's Environment Variables
  const GOOGLE_PROJECT_ID = process.env.GOOGLE_PROJECT_ID;
  const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!GOOGLE_PROJECT_ID || !GOOGLE_SERVICE_ACCOUNT_KEY) {
    return res.status(500).json({ error: 'Server configuration error. Missing API credentials.' });
  }

  let privateKey;
  let clientEmail;

  try {
    const keyData = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);
    privateKey = keyData.private_key;
    clientEmail = keyData.client_email;
  } catch (e) {
    return res.status(500).json({ error: 'Server configuration error. Invalid service account key format.' });
  }

  const vertex_ai = new VertexAI({
    project: GOOGLE_PROJECT_ID,
    location: 'us-central1',
    credentials: {
      private_key: privateKey,
      client_email: clientEmail,
    },
  });

  // Get the 'step' and 'payload' from the frontend
  const { step, payload } = req.body;

  try {
    let resultText;
    let base64Image;

    // --- Select Gemini 2.5 Flash ---
    // Note: Model names can change. Using gemini-2.5-flash-preview-09-2025 as an example.
    const textModel = vertex_ai.getGenerativeModel({
      model: 'gemini-2.5-flash-preview-09-2025',
    });
    
    // --- Select Imagen 3 ---
    const imageModel = vertex_ai.getGenerativeModel({
      model: 'imagen-3.0-generate-002',
    });

    switch (step) {
      // --- STAGE 1 & 4: Seed to Poem / Description to Interpretation ---
      case 'generateText': {
        const { systemPrompt, userQuery } = payload;
        const resp = await textModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: userQuery }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
        });
        resultText = resp.response.candidates[0].content.parts[0].text;
        return res.status(200).json({ text: resultText });
      }

      // --- STAGE 2: Poem to Image ---
      case 'generateImage': {
        const { prompt } = payload;
        const resp = await imageModel.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                responseModalities: ['IMAGE']
            }
        });
        
        // Use the first image response
        const imagePart = resp.response.candidates[0].content.parts.find(p => p.inlineData);
        if (!imagePart) {
            throw new Error('No image data returned from Imagen.');
        }
        
        base64Image = imagePart.inlineData.data;
        return res.status(200).json({ base64Image: base64Image });
      }

      // --- STAGE 3: Image to Description ---
      case 'describeImage': {
        const { systemPrompt, base64Data } = payload;
        
        const imagePart = {
          inlineData: {
            mimeType: 'image/png',
            data: base64Data,
          },
        };
        const textPart = { text: systemPrompt };

        const resp = await textModel.generateContent({
          contents: [{ role: 'user', parts: [textPart, imagePart] }],
        });

        resultText = resp.response.candidates[0].content.parts[0].text;
        return res.status(200).json({ text: resultText });
      }

      default:
        return res.status(400).json({ error: 'Invalid step provided' });
    }
  } catch (error) {
    console.error('Error calling Google AI:', error);
    return res.status(500).json({ error: `API Error: ${error.message}` });
  }
}
