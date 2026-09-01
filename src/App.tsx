/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileVideo, AlertCircle, CheckCircle2, Loader2, Bug, Play, Trash2, Copy, Edit2, Save, ExternalLink, Check, Mail, ChevronDown, ChevronUp, Github } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { generateBugReport } from './services/gemini';
import { markdownToRichHtml, markdownToPlainText } from './utils/formatters';

export default function App() {
  const [user, setUser] = useState<any>(() => {
    const saved = localStorage.getItem('bugsnap_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [firebaseAuth, setFirebaseAuth] = useState<any>(null);
  const [firebaseConfigured, setFirebaseConfigured] = useState<boolean>(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        
        const config = data.firebaseConfig;
        if (!config || !config.apiKey || config.apiKey === 'MY_FIREBASE_API_KEY') {
          setFirebaseConfigured(false);
          return;
        }

        const app = getApps().length === 0 ? initializeApp(config) : getApp();
        const auth = getAuth(app);
        setFirebaseAuth(auth);
        
        onAuthStateChanged(auth, (firebaseUser) => {
          if (firebaseUser) {
            const userData = {
              name: firebaseUser.displayName,
              email: firebaseUser.email,
              picture: firebaseUser.photoURL,
              uid: firebaseUser.uid,
            };
            setUser(userData);
            localStorage.setItem('bugsnap_user', JSON.stringify(userData));
          } else {
            setUser(null);
            localStorage.removeItem('bugsnap_user');
          }
        });
      } catch (err) {
        console.error("Failed to load Firebase configuration:", err);
        setFirebaseConfigured(false);
      }
    };

    fetchConfig();
  }, []);

  const handleSignIn = async () => {
    if (!firebaseAuth) return;
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(firebaseAuth, provider);
    } catch (err) {
      console.error("Google Sign-In failed:", err);
    }
  };

  const handleSignOut = async () => {
    if (firebaseAuth) {
      try {
        await signOut(firebaseAuth);
      } catch (err) {
        console.error("Sign out failed:", err);
      }
    } else {
      setUser(null);
      localStorage.removeItem('bugsnap_user');
    }
  };


  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [originalReport, setOriginalReport] = useState<string | null>(null);
  const [activePromptId, setActivePromptId] = useState<number | null>(null);
  const [editedReport, setEditedReport] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [showPublishPrompt, setShowPublishPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyOptions, setCopyOptions] = useState<{ text: string, onDone?: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verboseError, setVerboseError] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [isErrorHovered, setIsErrorHovered] = useState(false);
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [gitHubRepo, setGitHubRepo] = useState(() => localStorage.getItem('bugsnap_github_repo') || '');
  const [gitHubToken, setGitHubToken] = useState(() => localStorage.getItem('bugsnap_github_token') || '');
  const [isPublishingToGitHub, setIsPublishingToGitHub] = useState(false);
  const [gitHubPublishError, setGitHubPublishError] = useState<string | null>(null);
  const [gitHubPublishSuccess, setGitHubPublishSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (report) {
      setEditedReport(report);
    }
  }, [report]);

  const [showTimeoutMessage, setShowTimeoutMessage] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isProcessing) {
      timeoutRef.current = setTimeout(() => {
        setShowTimeoutMessage(true);
      }, 45000); // 45 seconds timeout
    } else {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setShowTimeoutMessage(false);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isProcessing]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 100 * 1024 * 1024) { // 100MB limit
        setError("File size too large. Please upload a video under 100MB.");
        return;
      }
      setVideoFile(file);
      setVideoPreview(URL.createObjectURL(file));
      setReport(null);
      setEditedReport('');
      setIsEditing(false);
      setShowPublishPrompt(false);
      setError(null);
    }
  };

  const removeFile = () => {
    setVideoFile(null);
    setVideoPreview(null);
    setReport(null);
    setEditedReport('');
    setIsEditing(false);
    setShowPublishPrompt(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleSubmit = async () => {
    if (!videoFile) return;

    setIsProcessing(true);
    setError(null);
    setVerboseError(null);
    setShowErrorDetails(false);
    setReport(null);
    setOriginalReport(null);
    setActivePromptId(null);
    setShowPublishPrompt(false);
    try {
      const base64 = await fileToBase64(videoFile);
      const result = await generateBugReport(base64, videoFile.type, videoFile.name);
      setReport(result.text);
      setOriginalReport(result.text);
      setActivePromptId(result.promptId);
    } catch (err: any) {
      console.error(err);
      setError("An error occurred while processing the video. Please try again.");
      setVerboseError(err instanceof Error ? err.stack || err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEmailError = () => {
    if (!verboseError) return;
    const subject = "BugSnap AI - Error Report";
    const body = `Hi Support team,\n\nI encountered an error while processing my video in BugSnap AI.\n\nError details:\n${verboseError}\n\nEnvironment details:\nURL: ${window.location.href}\nUser Agent: ${navigator.userAgent}\nTime: ${new Date().toISOString()}`;
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
  };

  const performCopy = async (format: 'rich' | 'markdown', text: string) => {
    if (format === 'rich') {
      try {
        const htmlContent = markdownToRichHtml(text);
        const plainText = markdownToPlainText(text);
        
        if (typeof ClipboardItem !== 'undefined') {
          const blobHtml = new Blob([htmlContent], { type: 'text/html' });
          const blobText = new Blob([plainText], { type: 'text/plain' });
          
          const data = [
            new ClipboardItem({
              'text/html': blobHtml,
              'text/plain': blobText,
            })
          ];
          await navigator.clipboard.write(data);
        } else {
          await navigator.clipboard.writeText(plainText);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Rich copy failed, falling back to plaintext:", err);
        await navigator.clipboard.writeText(markdownToPlainText(text));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Markdown copy failed:", err);
      }
    }
  };

  const triggerCopyFlow = (textToCopy: string = editedReport, onDone?: () => void) => {
    setCopyOptions({ text: textToCopy, onDone });
  };

  const logFeedback = async (finalText: string) => {
    if (!originalReport) return;
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          promptId: activePromptId,
          originalReport: originalReport,
          finalReport: finalText,
          videoMetadata: videoFile ? { name: videoFile.name, size: videoFile.size } : null
        })
      });
    } catch (err) {
      console.warn("Failed to log feedback:", err);
    }
  };

  const handleLooksGood = () => {
    logFeedback(editedReport);
    triggerCopyFlow(editedReport, () => {
      setShowPublishPrompt(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const handleSaveChanges = () => {
    setIsEditing(false);
    logFeedback(editedReport);
    triggerCopyFlow(editedReport, () => {
      setShowPublishPrompt(true);
    });
  };

  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [driveSaved, setDriveSaved] = useState(false);

  const handleSaveToDrive = async () => {
    setIsSavingToDrive(true);
    // Simulate API call to Drive
    await new Promise(resolve => setTimeout(resolve, 2000));
    setIsSavingToDrive(false);
    setDriveSaved(true);
  };

  const parseGitHubRepo = (input: string) => {
    let cleaned = input.trim().replace(/\/$/, "");
    if (cleaned.startsWith("https://github.com/")) {
      cleaned = cleaned.replace("https://github.com/", "");
    }
    const parts = cleaned.split("/");
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
    return null;
  };

  const extractBugReportTitle = (text: string) => {
    const match = text.match(/\*\*Title:\*\*\s*(.*)/i) || text.match(/#\s*(.*)/i) || text.match(/Title:\s*(.*)/i);
    return match ? match[1].replace(/\*\*|#/g, '').trim() : 'Bug Report - BugSnap AI';
  };

  const handleGitHubRedirectPublish = () => {
    setGitHubPublishError(null);
    setGitHubPublishSuccess(null);
    const repoInfo = parseGitHubRepo(gitHubRepo);
    if (!repoInfo) {
      setGitHubPublishError("Invalid repository format. Please enter as 'owner/repo' or a GitHub URL.");
      return;
    }
    
    const title = extractBugReportTitle(editedReport);
    const body = editedReport + "\n\n---\n*Generated with [BugSnap AI](https://ai.studio/build)*";
    
    const url = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    
    localStorage.setItem('bugsnap_github_repo', gitHubRepo);
    window.open(url, '_blank');
    setShowGitHubModal(false);
  };

  const handleGitHubAPIPublish = async () => {
    setIsPublishingToGitHub(true);
    setGitHubPublishError(null);
    setGitHubPublishSuccess(null);
    
    const repoInfo = parseGitHubRepo(gitHubRepo);
    if (!repoInfo) {
      setGitHubPublishError("Invalid repository format. Please enter as 'owner/repo' or a GitHub URL.");
      setIsPublishingToGitHub(false);
      return;
    }
    
    if (!gitHubToken.trim()) {
      setGitHubPublishError("Personal Access Token is required for automated creation.");
      setIsPublishingToGitHub(false);
      return;
    }
    
    try {
      const title = extractBugReportTitle(editedReport);
      const response = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/issues`, {
        method: 'POST',
        headers: {
          'Authorization': `token ${gitHubToken.trim()}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          title,
          body: editedReport + "\n\n---\n*Generated with [BugSnap AI](https://ai.studio/build)*",
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `GitHub API returned ${response.status}`);
      }
      
      const issueData = await response.json();
      setGitHubPublishSuccess(issueData.html_url);
      localStorage.setItem('bugsnap_github_repo', gitHubRepo);
      localStorage.setItem('bugsnap_github_token', gitHubToken);
    } catch (err: any) {
      console.error(err);
      setGitHubPublishError(err.message || "Failed to publish bug report. Please verify your token and repo access.");
    } finally {
      setIsPublishingToGitHub(false);
    }
  };

  const handlePublish = () => {
    window.open('http://buganizer.corp.google.com', '_blank');
  };

  const handleEmail = () => {
    // Try to extract title from report
    const titleMatch = editedReport.match(/\*\*Title:\*\*\s*(.*)/);
    const subject = titleMatch ? `Bug Report: ${titleMatch[1]}` : 'Bug Report from BugSnap AI';
    
    // Include both Markdown and Email-Friendly plain text
    const plainFriendly = markdownToPlainText(editedReport);
    const bodyText = `==================================================
BUG REPORT (GOOGLE DOC / EMAIL FRIENDLY VERSION)
==================================================

${plainFriendly}

==================================================
BUG REPORT (RAW MARKDOWN FORMAT)
==================================================

${editedReport}

--------------------------------------------------
Generated with BugSnap AI - Gemini 3.5`;

    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
    
    // Open in a new tab and keep it open as requested
    window.open(mailtoUrl, '_blank');
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 font-sans text-gray-900 flex flex-col items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 max-w-md w-full text-center space-y-6"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="bg-blue-600 p-3 rounded-2xl shadow-md">
              <Bug className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              BugSnap <span className="text-blue-600">AI</span>
            </h1>
            <p className="text-sm text-gray-500 font-medium">
              Powered by Gemini 3.5
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-gray-800">Welcome to BugSnap AI</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              Generate detailed, professional bug reports instantly from screen recordings using Google Gemini AI.
            </p>
          </div>

          <div className="border-t border-gray-100 pt-6 flex flex-col items-center justify-center min-h-[50px]">
            {firebaseConfigured ? (
              <button
                onClick={handleSignIn}
                className="flex items-center justify-center gap-3 w-full max-w-[280px] bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-xl font-semibold shadow-sm transition-all active:scale-95 cursor-pointer hover:border-gray-400"
              >
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Sign in with Google
              </button>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-left text-xs space-y-2">
                <p className="font-bold">Firebase Configuration Required</p>
                <p>To enable sign-in, please set your Firebase credentials in your Cloud Run or local configuration:</p>
                <code className="block bg-amber-100 p-2 rounded font-mono text-[9px] break-all select-all">
                  FIREBASE_API_KEY="..."<br/>
                  FIREBASE_AUTH_DOMAIN="..."
                </code>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {/* Google-style Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg">
              <Bug className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-medium tracking-tight text-gray-800">
              BugSnap <span className="text-blue-600">AI</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:inline">Powered by Gemini 3.5</span>
            {user.picture ? (
              <img 
                src={user.picture} 
                alt={user.name} 
                className="w-8 h-8 rounded-full border border-gray-200" 
                title={user.email}
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
                {user.name ? user.name[0] : 'U'}
              </div>
            )}
            <button
              onClick={handleSignOut}
              className="text-xs font-semibold text-gray-500 hover:text-red-650 border border-gray-200 hover:border-red-200 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h2 className="text-4xl font-bold text-gray-900 mb-4">Generate Bug Reports Instantly</h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Upload your screen recording. Our AI will analyze the video and audio to draft a comprehensive, professional bug report for your team.
          </p>
        </motion.div>

        <div className="grid gap-8">
          {/* Upload Section */}
          <section id="upload-section" className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-8">
              {!videoPreview ? (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-12 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all group"
                >
                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8 text-blue-600" />
                  </div>
                  <p className="text-lg font-medium text-gray-700">Click to upload or drag and drop</p>
                  <p className="text-sm text-gray-500 mt-1">MP4, WebM or MOV (max 100MB)</p>
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="video/*"
                    className="hidden"
                  />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-video shadow-lg">
                    <video 
                      src={videoPreview} 
                      controls 
                      className="w-full h-full object-contain"
                    />
                    <button 
                      onClick={removeFile}
                      className="absolute top-4 right-4 p-2 bg-white/90 hover:bg-white text-red-600 rounded-full shadow-md transition-colors"
                      title="Remove video"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                  
                  {/* Result Action Center - REPOSITIONED */}
                  <AnimatePresence>
                    {report && !isEditing && (
                      <motion.section
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl text-white shadow-lg p-6 flex flex-col items-center text-center gap-4 relative overflow-hidden"
                      >
                        {/* Pulsating Ring Effect */}
                        <div className="absolute inset-0 pointer-events-none">
                          <motion.div 
                            animate={{ scale: [1, 1.05, 1], opacity: [0.1, 0.2, 0.1] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="absolute inset-0 bg-white rounded-xl"
                          />
                        </div>

                        <div className="relative z-10 space-y-3">
                          <div className="flex flex-col items-center gap-1">
                            <div className="bg-white/20 p-1.5 rounded-full animate-bounce">
                              <CheckCircle2 className="w-6 h-6 text-white" />
                            </div>
                            <h3 className="text-2xl font-bold">Report Ready & Copied!</h3>
                            <p className="text-blue-100 text-sm max-w-lg">
                              The report has been automatically copied to your clipboard.
                            </p>
                          </div>

                          <div className="flex flex-wrap justify-center gap-3 pt-2">
                            <button 
                              onClick={() => {
                                setGitHubPublishError(null);
                                setGitHubPublishSuccess(null);
                                setShowGitHubModal(true);
                              }}
                              className="bg-gray-905 hover:bg-gray-900 text-white px-6 py-2 rounded-lg font-bold text-base flex items-center gap-2 shadow-md transition-all active:scale-95 border border-gray-800"
                            >
                              <Github className="w-4 h-4" />
                              Publish to GitHub
                            </button>

                            <button 
                              onClick={handlePublish}
                              className="bg-white text-blue-700 px-6 py-2 rounded-lg font-bold text-base flex items-center gap-2 hover:bg-blue-50 transition-all shadow-md active:scale-95"
                            >
                              <ExternalLink className="w-4 h-4" />
                              Open Buganizer
                            </button>

                            <button 
                              onClick={handleEmail}
                              className="bg-blue-500/30 border border-white/30 text-white px-6 py-2 rounded-lg font-bold text-base flex items-center gap-2 hover:bg-white/20 transition-all active:scale-95"
                            >
                              <Mail className="w-4 h-4" />
                              Email Report
                            </button>

                            {!driveSaved ? (
                              <button 
                                onClick={handleSaveToDrive}
                                disabled={isSavingToDrive}
                                className="bg-blue-500/30 border border-white/30 text-white px-6 py-2 rounded-lg font-bold text-base flex items-center gap-2 hover:bg-white/20 transition-all active:scale-95 disabled:opacity-50"
                              >
                                {isSavingToDrive ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save to Drive
                              </button>
                            ) : (
                              <div className="bg-green-500/40 border border-green-400 text-white px-6 py-2 rounded-lg font-bold text-base flex items-center gap-2">
                                <Check className="w-4 h-4" />
                                Saved
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.section>
                    )}
                  </AnimatePresence>

                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="flex items-center gap-3">
                      <FileVideo className="w-6 h-6 text-blue-600" />
                      <div>
                        <p className="font-medium text-gray-800 truncate max-w-[200px] sm:max-w-md">
                          {videoFile?.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {(videoFile!.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleSubmit}
                      disabled={isProcessing}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 transition-all shadow-sm active:scale-95"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Play className="w-5 h-5" />
                          Generate Report
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Error Message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-red-50 border border-red-200 rounded-xl p-5 flex flex-col gap-4 text-red-700 relative overflow-visible shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 relative">
                    {/* Information Circle with Interactive Hover Tooltip */}
                    <div 
                      className="relative cursor-pointer mt-0.5 flex-shrink-0"
                      onMouseEnter={() => setIsErrorHovered(true)}
                      onMouseLeave={() => setIsErrorHovered(false)}
                    >
                      <AlertCircle className="w-5 h-5 text-red-600 hover:text-red-800 transition-colors" />
                      
                      {/* Interactive Tooltip on hover */}
                      <AnimatePresence>
                        {isErrorHovered && verboseError && (
                          <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute bottom-full left-0 mb-2 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl w-64 z-20 pointer-events-none font-sans leading-relaxed"
                          >
                            <div className="font-semibold text-red-400 mb-1">Error Diagnostics:</div>
                            <div className="line-clamp-4 font-mono">
                              {verboseError}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-1.5 italic">Hover to look, click "Show Details" to copy or email</div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div className="space-y-1">
                      <p className="font-semibold text-red-800">Video Analysis Failed</p>
                      <p className="text-sm text-red-700">{error}</p>
                    </div>
                  </div>

                  {verboseError && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowErrorDetails(!showErrorDetails)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-xs font-semibold transition-all active:scale-95"
                        title="Toggle error details"
                      >
                        {showErrorDetails ? (
                          <>
                            <ChevronUp className="w-4 h-4" />
                            Hide Details
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-4 h-4" />
                            Show Details
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded Details Box */}
                <AnimatePresence>
                  {showErrorDetails && verboseError && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden border-t border-red-200/50 pt-4"
                    >
                      <div className="bg-red-900/5 rounded-lg p-3 font-mono text-xs text-red-900 max-h-48 overflow-y-auto whitespace-pre-wrap select-text border border-red-200">
                        {verboseError}
                      </div>

                      <div className="flex justify-end gap-3 mt-3">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(verboseError);
                          }}
                          className="px-3 py-1.5 text-xs font-semibold bg-white border border-red-200 hover:bg-red-100 text-red-800 rounded-lg transition-colors flex items-center gap-1.5 active:scale-95"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copy Stack Trace
                        </button>
                        <button
                          onClick={handleEmailError}
                          className="px-3 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-sm transition-colors flex items-center gap-1.5 active:scale-95"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          Email Details to Support
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Result Section */}
          <AnimatePresence>
            {report && (
              <motion.section
                id="report-section"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
              >
                <div className="border-b border-gray-100 bg-gray-50/50 px-8 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-green-700 font-semibold">
                    <CheckCircle2 className="w-5 h-5" />
                    Generated Bug Report
                  </div>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => triggerCopyFlow(editedReport)}
                      className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Copied!' : 'Copy to Clipboard'}
                    </button>
                    {!isEditing && (
                      <button 
                        onClick={() => setIsEditing(true)}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 font-medium transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                        Edit
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="p-8">
                  {isEditing ? (
                    <div className="space-y-4">
                      <textarea
                        value={editedReport}
                        onChange={(e) => setEditedReport(e.target.value)}
                        className="w-full h-[400px] p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm resize-none"
                        placeholder="Modify your bug report here..."
                      />
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => {
                            setEditedReport(report);
                            setIsEditing(false);
                          }}
                          className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveChanges}
                          className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-all flex items-center gap-2"
                        >
                          <Save className="w-4 h-4" />
                          Save & Copy
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="prose prose-blue max-w-none">
                      <div className="markdown-body">
                        <ReactMarkdown>{editedReport}</ReactMarkdown>
                      </div>
                      
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="mt-8 p-6 bg-blue-50 rounded-xl border border-blue-100 flex flex-col sm:flex-row items-center justify-between gap-4"
                      >
                        <p className="text-blue-800 font-medium">Would you like to edit anything in the report?</p>
                        <div className="flex gap-3">
                          <button 
                            onClick={() => setIsEditing(true)}
                            className="px-4 py-2 bg-white text-blue-600 border border-blue-200 rounded-lg font-medium hover:bg-blue-100 transition-colors"
                          >
                            Yes, Edit Report
                          </button>
                          <button 
                            onClick={handleLooksGood}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                          >
                            No, Looks Good
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Loading State Skeleton */}
          {isProcessing && !report && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gray-100 rounded-full animate-pulse" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-gray-100 rounded w-1/4 animate-pulse" />
                  <div className="h-3 bg-gray-100 rounded w-1/3 animate-pulse" />
                </div>
              </div>
              <div className="space-y-3">
                <div className="h-4 bg-gray-100 rounded w-full animate-pulse" />
                <div className="h-4 bg-gray-100 rounded w-full animate-pulse" />
                <div className="h-4 bg-gray-100 rounded w-3/4 animate-pulse" />
              </div>
              <div className="pt-4 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-2" />
                <p className="text-gray-600 font-medium">Gemini is watching your video...</p>
                <p className="text-sm text-gray-400">This usually takes 15-30 seconds</p>

                <AnimatePresence>
                  {showTimeoutMessage && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-6 p-4 bg-orange-50 border border-orange-200 rounded-xl max-w-sm shadow-sm"
                    >
                      <div className="flex items-center gap-2 text-orange-800 font-semibold mb-2 justify-center">
                        <AlertCircle className="w-4 h-4" />
                        Taking longer than usual
                      </div>
                      <p className="text-orange-700 text-sm mb-4">
                        The analysis seems to be taking a while. This can happen with larger files or network fluctuations.
                      </p>
                      <button 
                        onClick={() => window.location.reload()}
                        className="w-full py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition-all active:scale-95 shadow-md"
                      >
                        Restart Application
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      </main>

      <AnimatePresence>
        {copyOptions && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 border border-gray-100 flex flex-col gap-6"
            >
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 p-2.5 rounded-full text-blue-600">
                  <Copy className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-gray-950">Choose Copy Format</h4>
                  <p className="text-sm text-gray-500 mt-1">Select how you want to copy this report</p>
                </div>
              </div>

              <div className="grid gap-3">
                {/* Email / Doc Format */}
                <button
                  onClick={async () => {
                    await performCopy('rich', copyOptions.text);
                    const onDone = copyOptions.onDone;
                    setCopyOptions(null);
                    if (onDone) onDone();
                  }}
                  className="flex items-center justify-between p-4 bg-blue-50/50 hover:bg-blue-50 border border-blue-100 hover:border-blue-300 rounded-xl text-left transition-all group active:scale-[0.99] cursor-pointer"
                >
                  <div className="space-y-1 pr-2">
                    <span className="font-semibold text-blue-800 text-sm group-hover:text-blue-900 block">
                      Google Doc & Email Friendly
                    </span>
                    <span className="text-xs text-blue-600 font-medium block leading-relaxed">
                      Rich Text with inline styles. Retains beautiful colors, bolding, and lists when pasted into Gmail or Docs.
                    </span>
                  </div>
                  <div className="bg-blue-600 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <Check className="w-4 h-4" />
                  </div>
                </button>

                {/* Markdown Format */}
                <button
                  onClick={async () => {
                    await performCopy('markdown', copyOptions.text);
                    const onDone = copyOptions.onDone;
                    setCopyOptions(null);
                    if (onDone) onDone();
                  }}
                  className="flex items-center justify-between p-4 bg-gray-50/50 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 rounded-xl text-left transition-all group active:scale-[0.99] cursor-pointer"
                >
                  <div className="space-y-1 pr-2">
                    <span className="font-semibold text-gray-800 text-sm group-hover:text-gray-900 block">
                      Raw Markdown Format
                    </span>
                    <span className="text-xs text-gray-500 font-medium block leading-relaxed">
                      Standard text with # headings and **bold** labels. Best for Github issues, Buganizer, and editors.
                    </span>
                  </div>
                  <div className="bg-gray-800 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <Check className="w-4 h-4" />
                  </div>
                </button>
              </div>

              <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
                <button
                  onClick={() => setCopyOptions(null)}
                  className="px-4 py-2 hover:bg-gray-100 rounded-lg text-gray-600 text-sm font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGitHubModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-2xl max-w-lg w-full shadow-2xl p-6 border border-gray-100 flex flex-col gap-6 my-8"
            >
              <div className="flex items-center gap-3">
                <div className="bg-gray-100 p-2.5 rounded-full text-gray-900 border border-gray-200">
                  <Github className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-gray-950 block">Publish to GitHub</h4>
                  <p className="text-sm text-gray-500 mt-0.5">Submit this bug report directly to your GitHub Project</p>
                </div>
              </div>

              {/* Success state */}
              {gitHubPublishSuccess ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex flex-col items-center text-center gap-4 text-green-800">
                  <div className="bg-green-100 p-2 rounded-full text-green-600">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-lg">Issue Submitted Successfully!</p>
                    <p className="text-sm text-green-700">Your bug report has been filed as a new GitHub issue.</p>
                  </div>
                  <a
                    href={gitHubPublishSuccess}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold shadow-sm transition-colors mt-2 text-center"
                  >
                    View Issue on GitHub
                  </a>
                  <button
                    onClick={() => {
                      setGitHubPublishSuccess(null);
                      setShowGitHubModal(false);
                    }}
                    className="text-sm text-green-600 hover:text-green-700 underline font-medium cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700">
                      GitHub Repository <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={gitHubRepo}
                      onChange={(e) => setGitHubRepo(e.target.value)}
                      placeholder="owner/repo (e.g. google/angular or full URL)"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                    <p className="text-[11px] text-gray-500">
                      Enter the owner and repository name of the target GitHub project.
                    </p>
                  </div>

                  <div className="border-t border-gray-100 pt-4 space-y-4">
                    <div>
                      <h5 className="text-xs font-bold text-gray-500 tracking-wider uppercase mb-3">Option A: Quick Native Creation (Recommended)</h5>
                      <p className="text-xs text-gray-650 mb-3 leading-relaxed">
                        No authentication required. Opens a new tab on GitHub with the title and full bug report pre-filled. You can review and click submit!
                      </p>
                      <button
                        onClick={handleGitHubRedirectPublish}
                        disabled={!gitHubRepo.trim()}
                        className="w-full py-2.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 hover:border-blue-350 disabled:opacity-50 disabled:pointer-events-none rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Open Prefilled Creation Page
                      </button>
                    </div>

                    <div className="border-t border-gray-100 pt-4">
                      <h5 className="text-xs font-bold text-gray-500 tracking-wider uppercase mb-3">Option B: Automated API Submission</h5>
                      <p className="text-xs text-gray-650 mb-3 leading-relaxed">
                        File the issue from this page instantly. Requires a GitHub Personal Access Token with <code className="bg-gray-100 px-1 py-0.5 rounded text-red-600 font-mono text-[10px]">repo</code> permissions.
                      </p>
                      
                      <div className="space-y-3 mb-4 font-sans">
                        <label className="block text-xs font-bold text-gray-600">Personal Access Token</label>
                        <input
                          type="password"
                          value={gitHubToken}
                          onChange={(e) => setGitHubToken(e.target.value)}
                          placeholder="ghp_xxxxxxxxxxxx"
                          className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono placeholder:font-sans"
                        />
                        <a 
                          href="https://github.com/settings/tokens/new?scopes=repo&description=BugSnap%20AI"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1 font-medium w-fit"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Generate a Token on GitHub
                        </a>
                      </div>

                      <button
                        onClick={handleGitHubAPIPublish}
                        disabled={isPublishingToGitHub || !gitHubRepo.trim() || !gitHubToken.trim()}
                        className="w-full py-2.5 bg-gray-900 border border-gray-850 hover:bg-black disabled:opacity-50 disabled:pointer-events-none rounded-xl text-white text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isPublishingToGitHub ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            File Issue...
                          </>
                        ) : (
                          <>
                            <Github className="w-4 h-4" />
                            Automate Creation with Token
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {gitHubPublishError && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-855 rounded-xl text-xs font-medium leading-relaxed">
                      {gitHubPublishError}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
                <button
                  onClick={() => setShowGitHubModal(false)}
                  className="px-4 py-2 hover:bg-gray-100 rounded-lg text-gray-650 text-sm font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-500 text-sm">
        <p>© {new Date().getFullYear()} BugSnap AI. Built for developers who care about quality.</p>
      </footer>
    </div>
  );
}

