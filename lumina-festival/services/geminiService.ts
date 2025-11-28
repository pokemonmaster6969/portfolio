
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, Chat, GenerateContentResponse } from "@google/genai";

const API_KEY = process.env.API_KEY || '';

let chatSession: Chat | null = null;

export const initializeChat = (): Chat => {
  if (chatSession) return chatSession;

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  chatSession = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: `You are the AI assistant for Yash Solanki's personal portfolio.
      
      Persona: Professional, concise, minimalist. 
      
      Candidate Profile:
      - Name: Yash Solanki
      - Role: MERN-full stack Developer & Data Analyst.
      - Location: Ahmedabad, Gujarat, India.
      - Education: 
        1. MSc Biotechnology (7.5 CGPA, 2023-2025)
        2. PG Diploma Bioinformatics (9 CGPA, 2022-2023)
        3. BSc Microbiology (6.78 CGPA, 2019-2022)
      
      Skills:
      - Python (Selenium, Django, Flask, Scrapy, Scipy, Scikit-learn, Pytorch).
      - Web Dev (React, Node.js, HTML, CSS).
      - Data Analysis (Excel, Power BI, Pandas, NumPy, Matplotlib, Seaborn).
      - Database (SQL, PostgreSQL, MongoDB).
      
      Projects:
      - Avian Influenza Dashboard: React+Node/Express, PostgreSQL, 10k+ genomic datasets.
      - VNTRseeker: Node+HTML/CSS, bulk-sequence data processing.
      
      Certifications:
      - GenAI Powered Data Analytics (Forage)
      - Deloitte Australia Data Analytics
      - Commonwealth Bank Intro to Data Science

      Goal:
      - Answer questions about Yash's technical skills and projects.
      - Keep answers short and professional. 
      - If asked for contact, provide email: yashsolanki466@gmail.com`,
    },
  });

  return chatSession;
};

export const sendMessageToGemini = async (message: string): Promise<string> => {
  if (!API_KEY) {
    return "Offline mode. (API Key missing)";
  }

  try {
    const chat = initializeChat();
    const response: GenerateContentResponse = await chat.sendMessage({ message });
    return response.text || "No response generated.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Service temporarily unavailable.";
  }
};
