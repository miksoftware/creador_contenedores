"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, CheckCircle2, Server, Globe, Shield, Database, ChevronRight, Activity, Cpu, Play, Rocket, Zap, XCircle, ArrowLeft, GitBranch, Code2, Upload, FileText, X, Box, Package, Copy, Check, Clock, RefreshCw, Sparkles, ExternalLink, Trash2, Settings, Loader2, AlertTriangle, Wifi } from "lucide-react";
import { DOCKER_APPS } from "@/lib/docker-apps-generator";
import type { DockerApp } from "@/lib/docker-apps-generator";

// Types
type ProjectType = "php" | "laravel";
type PHPVersion = "7.3" | "8.3";
type StepType = "config" | "deploying" | "success" | "error";
type DeployMode = "php" | "docker-app" | "manage";

interface VPSProject {
    name: string;
    type: string;
    phpVersion: string;
    domain: string;
    path: string;
    size: string;
    containersRunning: number;
    containersTotal: number;
    containers: { name: string; status: string }[];
}

interface DeployStep {
    id: string;
    label: string;
    icon: string;
    status: 'pending' | 'active' | 'done';
}

const INITIAL_DEPLOY_STEPS: DeployStep[] = [
    { id: 'connect', label: 'Conectando al servidor', icon: '🔌', status: 'pending' },
    { id: 'docker', label: 'Configurando Docker', icon: '🐳', status: 'pending' },
    { id: 'containers', label: 'Creando contenedores', icon: '📦', status: 'pending' },
    { id: 'config', label: 'Configurando proyecto', icon: '🔧', status: 'pending' },
    { id: 'done', label: 'Finalizado', icon: '✅', status: 'pending' },
];

function detectStepFromLog(msg: string): string | null {
    const lower = msg.toLowerCase();
    if (lower.includes('connecting') || lower.includes('conectando') || lower.includes('ssh') || lower.includes('authenticat')) return 'connect';
    if (lower.includes('traefik') || lower.includes('docker network') || lower.includes('docker-compose') || lower.includes('docker compose')) return 'docker';
    if (lower.includes('creating') || lower.includes('container') || lower.includes('pulling') || lower.includes('starting services') || lower.includes('up -d')) return 'containers';
    if (lower.includes('configur') || lower.includes('deploy.sh') || lower.includes('composer') || lower.includes('artisan') || lower.includes('migrate') || lower.includes('.env') || lower.includes('chmod') || lower.includes('chown')) return 'config';
    if (lower.includes('json_start') || lower.includes('deployment complete') || lower.includes('successfully')) return 'done';
    return null;
}

export default function DeployDashboard() {
    const [step, setStep] = useState<StepType>("config");
    const [logs, setLogs] = useState<string[]>([]);
    const [result, setResult] = useState<any>(null);
    const [errorMessage, setErrorMessage] = useState<string>("");
    const [deployMode, setDeployMode] = useState<DeployMode>("php");
    const [deploySteps, setDeploySteps] = useState<DeployStep[]>(INITIAL_DEPLOY_STEPS);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const deployStartRef = useRef<number>(0);

    // Manage State
    const [projects, setProjects] = useState<VPSProject[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [deletingProject, setDeletingProject] = useState<string | null>(null);
    const [restartingProject, setRestartingProject] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [deleteLogs, setDeleteLogs] = useState<string[]>([]);
    const [manageConnected, setManageConnected] = useState(false);
    const deleteLogsEndRef = useRef<HTMLDivElement>(null);

    // RAM Optimization State
    const [optimizingRam, setOptimizingRam] = useState(false);
    const [optimizeRamLogs, setOptimizeRamLogs] = useState<string[]>([]);
    const optimizeRamLogsEndRef = useRef<HTMLDivElement>(null);

    // Migration State
    const [migratingProject, setMigratingProject] = useState<{ name: string; type: string } | null>(null);
    const [targetCreds, setTargetCreds] = useState({ host: "", username: "root", password: "" });
    const [newDomain, setNewDomain] = useState("");
    const [migrationLogs, setMigrationLogs] = useState<string[]>([]);
    const [isMigrating, setIsMigrating] = useState(false);
    const migrationLogsEndRef = useRef<HTMLDivElement>(null);

    // Config State
    const [config, setConfig] = useState({
        projectName: "",
        domain: "",
        type: "php" as ProjectType,
        phpVersion: "8.3" as PHPVersion,
        forceOverwrite: false,
        gitRepoUrl: "", // URL del repositorio Git
        gitBranch: "", // Rama del repo (main, master, etc.)
        sqlFileContent: "", // Contenido del archivo SQL (solo PHP 7.3)
        withRedis: true, // Redis para Laravel
        withNodeBuild: true, // Compilar assets con Node.js para Laravel
    });

    // Docker App Config
    const [appConfig, setAppConfig] = useState({
        appName: "n8n" as DockerApp,
        projectName: "",
        domain: "",
        forceOverwrite: false,
    });

    // SQL File state
    const [sqlFileName, setSqlFileName] = useState<string>("");
    const sqlInputRef = useRef<HTMLInputElement>(null);

    // Credentials State
    const [creds, setCreds] = useState({
        host: "",
        username: "root",
        password: "",
    });

    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    // Limpiar campos según versión PHP y tipo
    useEffect(() => {
        if (config.phpVersion === "8.3") {
            setConfig(prev => ({ ...prev, sqlFileContent: "" }));
            setSqlFileName("");
        }
        if (config.type !== "laravel") {
            setConfig(prev => ({ ...prev, withRedis: false, withNodeBuild: false }));
        } else {
            setConfig(prev => ({ ...prev, withRedis: true, withNodeBuild: true }));
        }
    }, [config.phpVersion, config.type]);

    // Handler para el archivo SQL
    const handleSqlFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.name.endsWith('.sql')) {
                alert('Por favor selecciona un archivo .sql');
                return;
            }
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target?.result as string;
                setConfig(prev => ({ ...prev, sqlFileContent: content }));
                setSqlFileName(file.name);
            };
            reader.readAsText(file);
        }
    };

    const removeSqlFile = () => {
        setConfig(prev => ({ ...prev, sqlFileContent: "" }));
        setSqlFileName("");
        if (sqlInputRef.current) {
            sqlInputRef.current.value = "";
        }
    };

    const copyToClipboard = async (text: string, fieldName: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(fieldName);
            setTimeout(() => setCopiedField(null), 2000);
        } catch {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            setCopiedField(fieldName);
            setTimeout(() => setCopiedField(null), 2000);
        }
    };

    const updateDeployStep = (stepId: string) => {
        setDeploySteps(prev => {
            const stepIndex = prev.findIndex(s => s.id === stepId);
            if (stepIndex === -1) return prev;
            return prev.map((s, i) => {
                if (i < stepIndex) return { ...s, status: 'done' as const };
                if (i === stepIndex) return { ...s, status: 'active' as const };
                return s;
            });
        });
    };

    const handleDeploy = async () => {
        if (deployMode === "php") {
            if (!config.projectName || !creds.host || !creds.password) return;
        } else {
            if (!appConfig.projectName || !creds.host || !creds.password) return;
        }

        setStep("deploying");
        setLogs(["🚀 Initializing deployment sequence..."]);
        setErrorMessage("");
        setDeploySteps(INITIAL_DEPLOY_STEPS.map(s => ({ ...s, status: 'pending' as const })));
        setElapsedTime(0);
        deployStartRef.current = Date.now();
        timerRef.current = setInterval(() => {
            setElapsedTime(Math.floor((Date.now() - deployStartRef.current) / 1000));
        }, 1000);

        let hasError = false;
        let detectedError = "";

        try {
            const bodyPayload: any = {
                host: creds.host,
                username: creds.username,
                password: creds.password,
            };

            if (deployMode === "php") {
                bodyPayload.projectConfig = config;
            } else {
                bodyPayload.dockerAppConfig = appConfig;
            }

            const response = await fetch("/api/deploy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyPayload),
            });

            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let jsonBuffer = "";
            let isCapturingJson = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split("\n").filter(Boolean);

                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.message) {
                            const msg = parsed.message;
                            setLogs((prev) => [...prev, msg]);

                            // Detect deploy step
                            const detectedStep = detectStepFromLog(msg);
                            if (detectedStep) updateDeployStep(detectedStep);

                            if (msg.includes("❌") || (msg.includes("Error:") && !msg.includes("SyntaxError"))) {
                                hasError = true;
                                detectedError = msg.replace(/\[[\d;]+m/g, '').trim();
                            }

                            if (msg.includes("JSON_START")) {
                                isCapturingJson = true;
                                jsonBuffer = "";
                                continue;
                            }
                            if (msg.includes("JSON_END")) {
                                isCapturingJson = false;
                                try {
                                    const cleanJson = jsonBuffer
                                        .replace(/\[\d+;?\d*m/g, '')
                                        .replace(/\[0m/g, '')
                                        .replace(/\s+/g, ' ')
                                        .trim();
                                    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
                                    if (jsonMatch) {
                                        const resultData = JSON.parse(jsonMatch[0]);
                                        setResult(resultData);
                                        if (timerRef.current) clearInterval(timerRef.current);
                                        setDeploySteps(prev => prev.map(s => ({ ...s, status: 'done' as const })));
                                        setStep("success");
                                        return;
                                    }
                                } catch (e) {
                                    console.error("Failed to parse result JSON:", e);
                                }
                                continue;
                            }

                            if (isCapturingJson) {
                                jsonBuffer += msg + " ";
                            }
                        }
                    } catch (e) {
                        setLogs((prev) => [...prev, line]);
                        // Detect deploy step from raw line
                        const rawStep = detectStepFromLog(line);
                        if (rawStep) updateDeployStep(rawStep);
                        if (line.includes("❌") || line.includes("Error:")) {
                            hasError = true;
                            detectedError = line.replace(/\[[\d;]+m/g, '').trim();
                        }

                        if (line.includes("JSON_START")) {
                            isCapturingJson = true;
                            jsonBuffer = "";
                        } else if (line.includes("JSON_END")) {
                            isCapturingJson = false;
                            try {
                                const cleanJson = jsonBuffer
                                    .replace(/\[\d+;?\d*m/g, '')
                                    .replace(/\[0m/g, '')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                                const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
                                if (jsonMatch) {
                                    const resultData = JSON.parse(jsonMatch[0]);
                                    setResult(resultData);
                                    if (timerRef.current) clearInterval(timerRef.current);
                                    setDeploySteps(prev => prev.map(s => ({ ...s, status: 'done' as const })));
                                    setStep("success");
                                    return;
                                }
                            } catch (e2) {
                                console.error("Failed to parse raw JSON:", e2);
                            }
                        } else if (isCapturingJson) {
                            jsonBuffer += line + " ";
                        }
                    }
                }
            }

            if (hasError) {
                setErrorMessage(detectedError || "Deployment failed");
                if (timerRef.current) clearInterval(timerRef.current);
                setStep("error");
            }
        } catch (error: any) {
            setLogs((prev) => [...prev, `❌ Error: ${error.message}`]);
            setErrorMessage(error.message);
            if (timerRef.current) clearInterval(timerRef.current);
            setStep("error");
        }
    };

    // =========================================
    // Project Management Functions
    // =========================================

    const handleListProjects = async () => {
        if (!creds.host || !creds.password) return;
        setLoadingProjects(true);
        setProjects([]);
        setDeleteLogs([]);
        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    host: creds.host,
                    username: creds.username,
                    password: creds.password,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setDeleteLogs([`❌ Error: ${data.error || 'Connection failed'}`]);
                setManageConnected(true); // show error in the connected view
            } else if (data.projects) {
                setProjects(data.projects);
                setManageConnected(true);
            } else {
                setDeleteLogs([`⚠️ No se recibieron datos del servidor`]);
                setManageConnected(true);
            }
        } catch (error: any) {
            setDeleteLogs([`❌ Error de conexión: ${error.message}`]);
            setManageConnected(true);
        } finally {
            setLoadingProjects(false);
        }
    };

    const handleDeleteProject = async (projectName: string) => {
        setDeletingProject(projectName);
        setDeleteLogs([]);
        setDeleteConfirm(null);

        try {
            const res = await fetch('/api/projects/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    host: creds.host,
                    username: creds.username,
                    password: creds.password,
                    projectName,
                }),
            });

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const text = decoder.decode(value);
                    const lines = text.split('\n').filter(Boolean);

                    for (const line of lines) {
                        try {
                            const parsed = JSON.parse(line);
                            setDeleteLogs(prev => [...prev, parsed.message]);
                        } catch {
                            setDeleteLogs(prev => [...prev, line]);
                        }
                    }
                }
            }

            // Remove from local list
            setProjects(prev => prev.filter(p => p.name !== projectName));
        } catch (error: any) {
            setDeleteLogs(prev => [...prev, `❌ Error: ${error.message}`]);
        } finally {
            setDeletingProject(null);
        }
    };

    // Auto-scroll delete logs
    useEffect(() => {
        deleteLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [deleteLogs]);

    const handleRestartProject = async (projectName: string, projectType: string) => {
        setRestartingProject(projectName);
        setDeleteLogs([]);

        try {
            const res = await fetch('/api/projects/restart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    host: creds.host,
                    username: creds.username,
                    password: creds.password,
                    projectName,
                    projectType,
                }),
            });

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const text = decoder.decode(value);
                    const lines = text.split('\n').filter(Boolean);

                    for (const line of lines) {
                        try {
                            const parsed = JSON.parse(line);
                            setDeleteLogs(prev => [...prev, parsed.message]);
                        } catch {
                            setDeleteLogs(prev => [...prev, line]);
                        }
                    }
                }
            }
        } catch (error: any) {
            setDeleteLogs(prev => [...prev, `❌ Error: ${error.message}`]);
        } finally {
            setRestartingProject(null);
        }
    };

    // Auto-scroll RAM optimization logs
    useEffect(() => {
        optimizeRamLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [optimizeRamLogs]);

    const handleOptimizeRam = async () => {
        if (!creds.host || !creds.password) return;
        setOptimizingRam(true);
        setOptimizeRamLogs(['🧠 Iniciando optimización de RAM...']);
        setDeleteLogs([]);

        try {
            const res = await fetch('/api/projects/optimize-ram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    host: creds.host,
                    username: creds.username,
                    password: creds.password,
                }),
            });

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const text = decoder.decode(value);
                    const lines = text.split('\n').filter(Boolean);

                    for (const line of lines) {
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.message) {
                                const msg = parsed.message.replace(/\[\d+;?\d*m/g, '').replace(/\[0m/g, '').trim();
                                if (msg) setOptimizeRamLogs(prev => [...prev, msg]);
                            }
                        } catch {
                            const clean = line.replace(/\[\d+;?\d*m/g, '').replace(/\[0m/g, '').trim();
                            if (clean) setOptimizeRamLogs(prev => [...prev, clean]);
                        }
                    }
                }
            }
        } catch (error: any) {
            setOptimizeRamLogs(prev => [...prev, `❌ Error: ${error.message}`]);
        } finally {
            setOptimizingRam(false);
        }
    };

    // Auto-scroll migration logs
    useEffect(() => {
        migrationLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [migrationLogs]);

    const handleMigrate = async () => {
        if (!migratingProject || !targetCreds.host || !targetCreds.password) return;
        
        setIsMigrating(true);
        setMigrationLogs([`🚀 Iniciando migración de ${migratingProject.name}...`]);

        try {
            const res = await fetch('/api/projects/migrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceCreds: {
                        host: creds.host,
                        username: creds.username,
                        password: creds.password,
                    },
                    targetCreds,
                    projectName: migratingProject.name,
                    projectType: migratingProject.type,
                    newDomain: newDomain || null,
                }),
            });

            if (!res.body) throw new Error("No response string from API");

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            
            let jsonBuffer = "";
            let isCapturingJson = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                const lines = text.split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.message) {
                            setMigrationLogs(prev => [...prev, parsed.message]);
                        } else {
                            if (parsed.success !== undefined) {
                                setMigrationLogs(prev => [...prev, parsed.success ? "✅ Migración exitosa" : "❌ Migración fallida"]);
                            }
                        }
                    } catch {
                        // Handle raw lines or JSON wrappers
                        if (line.includes("JSON_START")) {
                            isCapturingJson = true;
                            jsonBuffer = "";
                        } else if (line.includes("JSON_END")) {
                            isCapturingJson = false;
                            try {
                                const cleanJson = jsonBuffer.replace(/\[\d+;?\d*m/g, '').replace(/\[0m/g, '').replace(/\s+/g, ' ').trim();
                                const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
                                if (jsonMatch) {
                                    const parsed = JSON.parse(jsonMatch[0]);
                                    if (parsed.message) {
                                        setMigrationLogs(prev => [...prev, parsed.message]);
                                    }
                                }
                            } catch (e) {
                                console.error("Error parsing migrate json result", e);
                            }
                        } else if (isCapturingJson) {
                            jsonBuffer += line + " ";
                        } else {
                            // Render normal log line
                           setMigrationLogs(prev => [...prev, line.replace(/\[[\d;]+m/g, '').trim()]);
                        }
                    }
                }
            }
        } catch (error: any) {
            setMigrationLogs(prev => [...prev, `❌ Error: ${error.message}`]);
        } finally {
            setIsMigrating(false);
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto px-4 py-8 md:py-16">
            {/* Hero Header */}
            <motion.div
                initial={{ opacity: 0, y: -30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="text-center mb-12"
            >
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full mb-6"
                    style={{
                        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(139, 92, 246, 0.15))',
                        border: '1px solid rgba(99, 102, 241, 0.3)',
                        boxShadow: '0 0 30px rgba(99, 102, 241, 0.2)'
                    }}
                >
                    <Rocket className="w-5 h-5 text-indigo-400" />
                    <span className="text-sm font-semibold tracking-wider uppercase text-indigo-300">VPS Deployer</span>
                    <Zap className="w-4 h-4 text-yellow-400" />
                </motion.div>

                <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-4">
                    <span className="text-white">{deployMode === "manage" ? "Manage" : "Deploy Your"}</span>
                    <br />
                    <span className="gradient-text">{deployMode === "manage" ? "Your Projects" : deployMode === "php" ? "PHP Projects" : "Docker Apps"}</span>
                </h1>

                <p className="text-base md:text-lg text-gray-400 max-w-xl mx-auto leading-relaxed mb-8 text-center">
                    {deployMode === "manage" ? "Connect to your VPS and manage deployed projects." : <>Automated Docker deployment with Traefik SSL.<span className="text-gray-300"> No terminal required.</span></>}
                </p>

                {/* Mode Selector Tabs */}
                <div className="inline-flex gap-3 rounded-xl p-1.5" style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    <button
                        onClick={() => setDeployMode("php")}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300"
                        style={{
                            background: deployMode === "php" ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)' : 'transparent',
                            color: deployMode === "php" ? 'white' : '#9ca3af',
                        }}
                    >
                        <Code2 className="w-4 h-4" />
                        PHP / Laravel
                    </button>
                    <button
                        onClick={() => setDeployMode("docker-app")}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300"
                        style={{
                            background: deployMode === "docker-app" ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)' : 'transparent',
                            color: deployMode === "docker-app" ? 'white' : '#9ca3af',
                        }}
                    >
                        <Box className="w-4 h-4" />
                        Docker Apps
                    </button>
                    <button
                        onClick={() => setDeployMode("manage")}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300"
                        style={{
                            background: deployMode === "manage" ? 'linear-gradient(135deg, #f59e0b, #ef4444)' : 'transparent',
                            color: deployMode === "manage" ? 'white' : '#9ca3af',
                        }}
                    >
                        <Settings className="w-4 h-4" />
                        Administrar
                    </button>
                </div>
            </motion.div>

            <AnimatePresence mode="wait">
                {step === "config" && deployMode !== "manage" && (
                    <motion.div
                        key="config"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.5 }}
                    >
                        {/* Main Card Container */}
                        <div
                            className="rounded-3xl overflow-hidden"
                            style={{
                                background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.8), rgba(15, 23, 42, 0.4))',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset'
                            }}
                        >
                            <div className="grid md:grid-cols-2 gap-0">
                                {/* Left Panel - Configuration */}
                                <div className="p-6 md:p-8 border-b md:border-b-0 md:border-r border-white/10">
                                    <div className="flex items-center gap-3 mb-8">
                                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${deployMode === "php" ? "from-blue-500 to-cyan-500" : "from-orange-500 to-pink-500"} flex items-center justify-center`}>
                                            {deployMode === "php" ? <Activity className="w-5 h-5 text-white" /> : <Package className="w-5 h-5 text-white" />}
                                        </div>
                                        <h3 className="text-lg font-bold text-white">{deployMode === "php" ? "Project Configuration" : "Docker App"}</h3>
                                    </div>

                                    {deployMode === "docker-app" ? (
                                        <div className="space-y-5">
                                            {/* App Selector */}
                                            <div className="space-y-2">
                                                <label className="block text-sm font-medium text-gray-400">Select App</label>
                                                <div className="grid grid-cols-1 gap-2">
                                                    {(Object.entries(DOCKER_APPS) as [DockerApp, typeof DOCKER_APPS[DockerApp]][]).map(([key, app]) => (
                                                        <label
                                                            key={key}
                                                            className="flex items-center gap-3 cursor-pointer p-3 rounded-xl transition-all duration-300"
                                                            style={{
                                                                background: appConfig.appName === key ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                                                                border: appConfig.appName === key ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(255, 255, 255, 0.05)',
                                                            }}
                                                        >
                                                            <input
                                                                type="radio"
                                                                name="dockerApp"
                                                                value={key}
                                                                checked={appConfig.appName === key}
                                                                onChange={() => setAppConfig({ ...appConfig, appName: key })}
                                                                className="sr-only"
                                                            />
                                                            <span className="text-xl">{app.icon}</span>
                                                            <div className="flex-1 min-w-0">
                                                                <span className={`text-sm font-semibold ${appConfig.appName === key ? 'text-white' : 'text-gray-400'}`}>{app.label}</span>
                                                                <p className="text-xs text-gray-500">{app.description}</p>
                                                            </div>
                                                            {appConfig.appName === key && (
                                                                <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0">
                                                                    <span className="text-white text-xs">✓</span>
                                                                </div>
                                                            )}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Project Name */}
                                            <div className="space-y-1.5">
                                                <label className="block text-sm font-medium text-gray-400">Container Name</label>
                                                <input
                                                    type="text"
                                                    placeholder="my-n8n"
                                                    value={appConfig.projectName}
                                                    onChange={(e) => setAppConfig({ ...appConfig, projectName: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300"
                                                    style={{ background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                                                />
                                            </div>

                                            {/* Domain */}
                                            <div className="space-y-1.5">
                                                <label className="block text-sm font-medium text-gray-400">
                                                    Domain <span className="text-gray-600">(Optional - enables SSL)</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="n8n.example.com"
                                                    value={appConfig.domain}
                                                    onChange={(e) => setAppConfig({ ...appConfig, domain: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300"
                                                    style={{ background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                                                />
                                            </div>

                                            {/* Force Overwrite */}
                                            <label
                                                className="flex items-center gap-3 cursor-pointer group p-3 rounded-xl transition-all duration-300"
                                                style={{
                                                    background: appConfig.forceOverwrite ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                                                    border: appConfig.forceOverwrite ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                                                }}
                                            >
                                                <div
                                                    className="relative w-10 h-6 rounded-full transition-all duration-300 flex-shrink-0"
                                                    style={{ background: appConfig.forceOverwrite ? 'linear-gradient(135deg, #ef4444, #f97316)' : 'rgba(255, 255, 255, 0.1)' }}
                                                >
                                                    <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300" style={{ left: appConfig.forceOverwrite ? '22px' : '4px' }} />
                                                </div>
                                                <input type="checkbox" checked={appConfig.forceOverwrite} onChange={(e) => setAppConfig({ ...appConfig, forceOverwrite: e.target.checked })} className="sr-only" />
                                                <div className="flex-1 min-w-0">
                                                    <span className={`text-sm font-medium ${appConfig.forceOverwrite ? 'text-orange-400' : 'text-gray-400'}`}>Overwrite existing</span>
                                                    <p className="text-xs text-gray-500 truncate">{appConfig.forceOverwrite ? '⚠️ Will delete existing' : 'Enable to reinstall'}</p>
                                                </div>
                                            </label>
                                        </div>
                                    ) : (
                                        <div className="space-y-5">
                                            {/* Project Name */}
                                            <div className="space-y-1.5">
                                                <label className="block text-sm font-medium text-gray-400">Project Name</label>
                                                <input
                                                    type="text"
                                                    placeholder="my-project"
                                                    value={config.projectName}
                                                    onChange={(e) => setConfig({ ...config, projectName: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300"
                                                    style={{
                                                        background: 'rgba(0, 0, 0, 0.4)',
                                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                                    }}
                                                />
                                            </div>

                                            {/* Domain */}
                                            <div className="space-y-1.5">
                                                <label className="block text-sm font-medium text-gray-400">
                                                    Domain <span className="text-gray-600">(Optional - enables SSL)</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="example.com"
                                                    value={config.domain}
                                                    onChange={(e) => setConfig({ ...config, domain: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300"
                                                    style={{
                                                        background: 'rgba(0, 0, 0, 0.4)',
                                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                                    }}
                                                />
                                            </div>

                                            {/* Type & PHP Version */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1.5">
                                                    <label className="block text-sm font-medium text-gray-400">Type</label>
                                                    <div className="relative">
                                                        <select
                                                            value={config.type}
                                                            onChange={(e) => setConfig({ ...config, type: e.target.value as ProjectType })}
                                                            className="w-full px-4 py-3 rounded-xl text-white text-sm font-medium appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300"
                                                            style={{
                                                                background: 'rgba(0, 0, 0, 0.4)',
                                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                            }}
                                                        >
                                                            <option value="php" className="bg-gray-900">PHP Pure</option>
                                                            <option value="laravel" className="bg-gray-900">Laravel</option>
                                                        </select>
                                                        <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 rotate-90 pointer-events-none" />
                                                    </div>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="block text-sm font-medium text-gray-400">PHP Version</label>
                                                    <div className="relative">
                                                        <select
                                                            value={config.phpVersion}
                                                            onChange={(e) => setConfig({ ...config, phpVersion: e.target.value as PHPVersion })}
                                                            className="w-full px-4 py-3 rounded-xl text-white text-sm font-medium appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300"
                                                            style={{
                                                                background: 'rgba(0, 0, 0, 0.4)',
                                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                            }}
                                                        >
                                                            <option value="8.3" className="bg-gray-900">PHP 8.3</option>
                                                            <option value="7.3" className="bg-gray-900">PHP 7.3</option>
                                                        </select>
                                                        <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 rotate-90 pointer-events-none" />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Git Repository URL - Para todas las versiones */}
                                            <div className="space-y-1.5">
                                                <label className="flex items-center gap-2 text-sm font-medium text-gray-400">
                                                    <GitBranch className="w-4 h-4 text-green-400" />
                                                    Git Repository URL
                                                    {config.type === "laravel" ? (
                                                        <span className="text-red-400 text-xs">(Required)</span>
                                                    ) : (
                                                        <span className="text-gray-600">(Optional)</span>
                                                    )}
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="https://github.com/user/repo.git"
                                                    value={config.gitRepoUrl}
                                                    onChange={(e) => setConfig({ ...config, gitRepoUrl: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300"
                                                    style={{
                                                        background: 'rgba(34, 197, 94, 0.05)',
                                                        border: '1px solid rgba(34, 197, 94, 0.2)',
                                                    }}
                                                />
                                                {config.type === "laravel" && (
                                                    <div className="mt-2">
                                                        <label className="block text-xs font-medium text-gray-500 mb-1">Branch (optional, default: main)</label>
                                                        <input
                                                            type="text"
                                                            placeholder="main"
                                                            value={config.gitBranch}
                                                            onChange={(e) => setConfig({ ...config, gitBranch: e.target.value })}
                                                            className="w-full px-3 py-2 rounded-lg text-white placeholder-gray-600 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500/30 transition-all duration-300"
                                                            style={{
                                                                background: 'rgba(34, 197, 94, 0.03)',
                                                                border: '1px solid rgba(34, 197, 94, 0.15)',
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                                <p className="text-xs text-gray-500 mt-1">
                                                    {config.type === "laravel"
                                                        ? <>Se clonará el proyecto, se ejecutará <code className="text-green-400/80">composer install</code>, <code className="text-green-400/80">artisan migrate</code> y más</>
                                                        : <>El repositorio se clonará en <code className="text-green-400/80">public/</code> y se creará un script <code className="text-green-400/80">deploy.sh</code></>
                                                    }
                                                </p>
                                            </div>

                                            {/* Laravel Options - Redis y Node.js */}
                                            <AnimatePresence>
                                                {config.type === "laravel" && config.phpVersion === "8.3" && (
                                                    <motion.div
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: "auto" }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        transition={{ duration: 0.3 }}
                                                        className="space-y-2 overflow-hidden"
                                                    >
                                                        <label className="flex items-center gap-2 text-sm font-medium text-gray-400 mb-2">
                                                            <Cpu className="w-4 h-4 text-purple-400" />
                                                            Laravel Options
                                                        </label>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <label
                                                                className="flex items-center gap-2 cursor-pointer p-2.5 rounded-lg transition-all duration-300"
                                                                style={{
                                                                    background: config.withRedis ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                                                                    border: config.withRedis ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                                                                }}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={config.withRedis}
                                                                    onChange={(e) => setConfig({ ...config, withRedis: e.target.checked })}
                                                                    className="sr-only"
                                                                />
                                                                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${config.withRedis ? 'bg-red-500 border-red-500' : 'border-gray-600'
                                                                    }`}>
                                                                    {config.withRedis && <span className="text-white text-xs">✓</span>}
                                                                </div>
                                                                <span className={`text-xs font-medium ${config.withRedis ? 'text-red-400' : 'text-gray-500'}`}>
                                                                    Redis
                                                                </span>
                                                            </label>
                                                            <label
                                                                className="flex items-center gap-2 cursor-pointer p-2.5 rounded-lg transition-all duration-300"
                                                                style={{
                                                                    background: config.withNodeBuild ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                                                                    border: config.withNodeBuild ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                                                                }}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={config.withNodeBuild}
                                                                    onChange={(e) => setConfig({ ...config, withNodeBuild: e.target.checked })}
                                                                    className="sr-only"
                                                                />
                                                                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${config.withNodeBuild ? 'bg-green-500 border-green-500' : 'border-gray-600'
                                                                    }`}>
                                                                    {config.withNodeBuild && <span className="text-white text-xs">✓</span>}
                                                                </div>
                                                                <span className={`text-xs font-medium ${config.withNodeBuild ? 'text-green-400' : 'text-gray-500'}`}>
                                                                    Node.js Build
                                                                </span>
                                                            </label>
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>

                                            {/* SQL File Upload - Solo para PHP 7.3 */}
                                            <AnimatePresence>
                                                {config.phpVersion === "7.3" && (
                                                    <motion.div
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: "auto" }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        transition={{ duration: 0.3 }}
                                                        className="space-y-1.5 overflow-hidden"
                                                    >
                                                        <label className="flex items-center gap-2 text-sm font-medium text-gray-400">
                                                            <Database className="w-4 h-4 text-orange-400" />
                                                            SQL File
                                                            <span className="text-gray-600">(Optional)</span>
                                                        </label>

                                                        {!sqlFileName ? (
                                                            <div
                                                                onClick={() => sqlInputRef.current?.click()}
                                                                className="w-full px-4 py-4 rounded-xl cursor-pointer transition-all duration-300 flex items-center justify-center gap-3 hover:border-orange-400/50"
                                                                style={{
                                                                    background: 'rgba(249, 115, 22, 0.05)',
                                                                    border: '1px dashed rgba(249, 115, 22, 0.3)',
                                                                }}
                                                            >
                                                                <Upload className="w-5 h-5 text-orange-400" />
                                                                <span className="text-sm text-gray-400">Click para subir archivo .sql</span>
                                                            </div>
                                                        ) : (
                                                            <div
                                                                className="w-full px-4 py-3 rounded-xl flex items-center justify-between"
                                                                style={{
                                                                    background: 'rgba(249, 115, 22, 0.1)',
                                                                    border: '1px solid rgba(249, 115, 22, 0.3)',
                                                                }}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <FileText className="w-4 h-4 text-orange-400" />
                                                                    <span className="text-sm text-white font-mono">{sqlFileName}</span>
                                                                </div>
                                                                <button
                                                                    onClick={removeSqlFile}
                                                                    className="p-1 rounded-lg hover:bg-red-500/20 transition-colors"
                                                                >
                                                                    <X className="w-4 h-4 text-red-400" />
                                                                </button>
                                                            </div>
                                                        )}

                                                        <input
                                                            ref={sqlInputRef}
                                                            type="file"
                                                            accept=".sql"
                                                            onChange={handleSqlFileChange}
                                                            className="hidden"
                                                        />
                                                        <p className="text-xs text-gray-500 mt-1">
                                                            Se importará automáticamente a la base de datos <code className="text-orange-400/80">{config.projectName || 'proyecto'}_db</code>
                                                        </p>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>

                                            {/* Force Overwrite Toggle */}
                                            <label
                                                className="flex items-center gap-3 cursor-pointer group p-3 rounded-xl transition-all duration-300"
                                                style={{
                                                    background: config.forceOverwrite ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                                                    border: config.forceOverwrite ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                                                }}
                                            >
                                                <div
                                                    className="relative w-10 h-6 rounded-full transition-all duration-300 flex-shrink-0"
                                                    style={{
                                                        background: config.forceOverwrite ? 'linear-gradient(135deg, #ef4444, #f97316)' : 'rgba(255, 255, 255, 0.1)',
                                                    }}
                                                >
                                                    <div
                                                        className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300"
                                                        style={{
                                                            left: config.forceOverwrite ? '22px' : '4px',
                                                        }}
                                                    />
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={config.forceOverwrite}
                                                    onChange={(e) => setConfig({ ...config, forceOverwrite: e.target.checked })}
                                                    className="sr-only"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <span className={`text-sm font-medium ${config.forceOverwrite ? 'text-orange-400' : 'text-gray-400'}`}>
                                                        Overwrite existing project
                                                    </span>
                                                    <p className="text-xs text-gray-500 truncate">
                                                        {config.forceOverwrite
                                                            ? '⚠️ Will delete existing project'
                                                            : 'Enable to reinstall'
                                                        }
                                                    </p>
                                                </div>
                                            </label>
                                        </div>
                                    )}
                                </div>

                                {/* Right Panel - VPS Credentials */}
                                <div className="p-6 md:p-8 flex flex-col">
                                    <div className="flex items-center gap-3 mb-8">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                                            <Shield className="w-5 h-5 text-white" />
                                        </div>
                                        <h3 className="text-lg font-bold text-white">VPS Credentials</h3>
                                    </div>

                                    <div className="space-y-5 flex-1">
                                        {/* Host */}
                                        <div className="space-y-1.5">
                                            <label className="block text-sm font-medium text-gray-400">IP Address / Host</label>
                                            <input
                                                type="text"
                                                placeholder="192.168.1.1"
                                                value={creds.host}
                                                onChange={(e) => setCreds({ ...creds, host: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-all duration-300"
                                                style={{
                                                    background: 'rgba(0, 0, 0, 0.4)',
                                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                                }}
                                            />
                                        </div>

                                        {/* User & Password */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <label className="block text-sm font-medium text-gray-400">User</label>
                                                <input
                                                    type="text"
                                                    value={creds.username}
                                                    onChange={(e) => setCreds({ ...creds, username: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-all duration-300"
                                                    style={{
                                                        background: 'rgba(0, 0, 0, 0.4)',
                                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                                    }}
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="block text-sm font-medium text-gray-400">Password</label>
                                                <input
                                                    type="password"
                                                    placeholder="••••••••"
                                                    value={creds.password}
                                                    onChange={(e) => setCreds({ ...creds, password: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-all duration-300"
                                                    style={{
                                                        background: 'rgba(0, 0, 0, 0.4)',
                                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Deploy Button */}
                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={handleDeploy}
                                        disabled={deployMode === "php"
                                            ? (!config.projectName || !creds.host || !creds.password || (config.type === 'laravel' && config.phpVersion === '8.3' && !config.gitRepoUrl))
                                            : (!appConfig.projectName || !creds.host || !creds.password)
                                        }
                                        className="w-full mt-8 py-4 rounded-xl font-bold text-base flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 text-white"
                                        style={{
                                            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                            boxShadow: '0 10px 40px -10px rgba(99, 102, 241, 0.5)',
                                        }}
                                    >
                                        <Play className="w-5 h-5 fill-current" />
                                        <span>Deploy Now</span>
                                    </motion.button>
                                </div>
                            </div>
                        </div>

                        {/* Features Row */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                            {(deployMode === "php" ? [
                                { icon: Server, label: "Docker", color: "from-blue-500 to-cyan-500" },
                                { icon: Globe, label: "Auto SSL", color: "from-green-500 to-emerald-500" },
                                { icon: Database, label: config.type === "laravel" && config.withRedis ? "MySQL + Redis" : "MySQL 8", color: "from-orange-500 to-amber-500" },
                                { icon: Code2, label: config.type === "laravel" ? `Laravel 8.3` : `PHP ${config.phpVersion}`, color: "from-purple-500 to-pink-500" },
                            ] : [
                                { icon: Box, label: "Docker", color: "from-blue-500 to-cyan-500" },
                                { icon: Globe, label: "Auto SSL", color: "from-green-500 to-emerald-500" },
                                { icon: Package, label: DOCKER_APPS[appConfig.appName]?.label || "App", color: "from-orange-500 to-amber-500" },
                                { icon: Shield, label: "Traefik", color: "from-purple-500 to-pink-500" },
                            ]).map((feature, i) => (
                                <motion.div
                                    key={feature.label}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.3 + i * 0.1 }}
                                    className="flex items-center justify-center gap-2 py-3 rounded-xl"
                                    style={{
                                        background: 'rgba(255, 255, 255, 0.03)',
                                        border: '1px solid rgba(255, 255, 255, 0.05)',
                                    }}
                                >
                                    <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${feature.color} flex items-center justify-center`}>
                                        <feature.icon className="w-3.5 h-3.5 text-white" />
                                    </div>
                                    <span className="text-xs font-medium text-gray-400">{feature.label}</span>
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* ===== MANAGE VIEW ===== */}
                {step === "config" && deployMode === "manage" && (
                    <motion.div
                        key="manage"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.5 }}
                    >
                        <div
                            className="rounded-3xl overflow-hidden"
                            style={{
                                background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.8), rgba(15, 23, 42, 0.4))',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                            }}
                        >
                            {/* Header */}
                            <div className="px-6 md:px-8 py-6 border-b border-white/5">
                                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-red-500 flex items-center justify-center">
                                        <Settings className="w-5 h-5 text-white" />
                                    </div>
                                    Administrar Proyectos
                                </h2>
                                <p className="text-gray-400 text-sm mt-2 ml-[52px]">Conecta a tu VPS para listar y eliminar proyectos desplegados.</p>
                            </div>

                            <div className="p-6 md:p-8">
                                {/* Connection form */}
                                {!manageConnected ? (
                                    <div className="max-w-md mx-auto">
                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-xs font-semibold text-gray-400 mb-1 block">IP Address / Host</label>
                                                <input
                                                    type="text"
                                                    placeholder="192.168.1.1"
                                                    value={creds.host}
                                                    onChange={(e) => setCreds({ ...creds, host: e.target.value })}
                                                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-amber-500/50 font-mono transition-colors"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="text-xs font-semibold text-gray-400 mb-1 block">User</label>
                                                    <input
                                                        type="text"
                                                        value={creds.username}
                                                        onChange={(e) => setCreds({ ...creds, username: e.target.value })}
                                                        className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-amber-500/50 font-mono transition-colors"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-semibold text-gray-400 mb-1 block">Password</label>
                                                    <input
                                                        type="password"
                                                        placeholder="••••••••"
                                                        value={creds.password}
                                                        onChange={(e) => setCreds({ ...creds, password: e.target.value })}
                                                        className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-amber-500/50 font-mono transition-colors"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <motion.button
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            onClick={handleListProjects}
                                            disabled={loadingProjects || !creds.host || !creds.password}
                                            className="w-full mt-6 py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-all"
                                            style={{
                                                background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                                                boxShadow: '0 10px 40px -10px rgba(245, 158, 11, 0.4)',
                                            }}
                                        >
                                            {loadingProjects ? (
                                                <><Loader2 className="w-5 h-5 animate-spin" /> Conectando...</>
                                            ) : (
                                                <><Wifi className="w-5 h-5" /> Conectar y Listar Proyectos</>
                                            )}
                                        </motion.button>
                                    </div>
                                ) : (
                                    <div>
                                        {/* Connected header */}
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-3">
                                                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                                                <span className="text-sm text-gray-400">Conectado a <span className="text-white font-mono">{creds.host}</span></span>
                                                <span className="text-xs text-gray-500 px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>{projects.length} proyectos</span>
                                            </div>
                                            <div className="flex gap-2 flex-wrap">
                                                <motion.button
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    onClick={handleOptimizeRam}
                                                    disabled={optimizingRam || loadingProjects}
                                                    className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50 text-white"
                                                    style={{
                                                        background: optimizingRam ? 'rgba(34, 197, 94, 0.3)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                                                        border: '1px solid rgba(34, 197, 94, 0.4)',
                                                        boxShadow: optimizingRam ? 'none' : '0 4px 15px -3px rgba(34, 197, 94, 0.3)',
                                                    }}
                                                >
                                                    {optimizingRam ? (
                                                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Optimizando...</>
                                                    ) : (
                                                        <><Cpu className="w-3.5 h-3.5" /> Optimizar RAM</>
                                                    )}
                                                </motion.button>
                                                <motion.button
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    onClick={handleListProjects}
                                                    disabled={loadingProjects}
                                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-400 flex items-center gap-1.5 transition-colors hover:text-white"
                                                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                                                >
                                                    <RefreshCw className={`w-3.5 h-3.5 ${loadingProjects ? 'animate-spin' : ''}`} /> Refrescar
                                                </motion.button>
                                                <motion.button
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    onClick={() => { setManageConnected(false); setProjects([]); setDeleteLogs([]); setOptimizeRamLogs([]); }}
                                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-400 flex items-center gap-1.5 transition-colors hover:text-white"
                                                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                                                >
                                                    <X className="w-3.5 h-3.5" /> Desconectar
                                                </motion.button>
                                            </div>
                                        </div>

                                        {/* Delete logs panel */}
                                        {deleteLogs.length > 0 && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                className="mb-6 rounded-xl overflow-hidden"
                                                style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)' }}
                                            >
                                                <div className="px-4 py-2 flex items-center justify-between" style={{ background: 'rgba(0,0,0,0.3)' }}>
                                                    <span className="text-xs text-gray-500 font-mono flex items-center gap-2"><Terminal className="w-3.5 h-3.5" /> Deletion Log</span>
                                                    <button onClick={() => setDeleteLogs([])} className="text-gray-600 hover:text-gray-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
                                                </div>
                                                <div className="p-4 max-h-48 overflow-y-auto custom-scrollbar font-mono text-xs">
                                                    {deleteLogs.map((log, i) => (
                                                        <div key={i} className="text-gray-300 mb-1 break-all">
                                                            <span className="text-amber-500 mr-2 select-none">❯</span>{log}
                                                        </div>
                                                    ))}
                                                    <div ref={deleteLogsEndRef} />
                                                </div>
                                            </motion.div>
                                        )}

                                        {/* Optimize RAM logs panel */}
                                        {optimizeRamLogs.length > 0 && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                className="mb-6 rounded-xl overflow-hidden"
                                                style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(34, 197, 94, 0.15)' }}
                                            >
                                                <div className="px-4 py-2 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(22, 163, 74, 0.05))' }}>
                                                    <span className="text-xs text-green-400 font-mono flex items-center gap-2">
                                                        <Cpu className="w-3.5 h-3.5" /> RAM Optimization Log
                                                        {optimizingRam && <Loader2 className="w-3 h-3 animate-spin text-green-500" />}
                                                    </span>
                                                    {!optimizingRam && (
                                                        <button onClick={() => setOptimizeRamLogs([])} className="text-gray-600 hover:text-gray-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
                                                    )}
                                                </div>
                                                <div className="p-4 max-h-72 overflow-y-auto custom-scrollbar font-mono text-xs">
                                                    {optimizeRamLogs.map((log, i) => {
                                                        const isError = log.includes('❌') || log.includes('ERROR');
                                                        const isSuccess = log.includes('✅') || log.includes('✓') || log.includes('DONE');
                                                        const isSkip = log.includes('⏭️') || log.includes('SKIP');
                                                        const isSummary = log.includes('OPTIMIZE_SUMMARY') || log.includes('📊');
                                                        return (
                                                            <div key={i} className={`mb-1.5 break-all ${isError ? 'text-red-400' : isSuccess ? 'text-green-400' : isSkip ? 'text-yellow-400' : isSummary ? 'text-cyan-400 font-semibold' : 'text-gray-300'}`}>
                                                                <span className="text-green-500 mr-2 select-none">❯</span>{log}
                                                            </div>
                                                        );
                                                    })}
                                                    <div ref={optimizeRamLogsEndRef} />
                                                </div>
                                            </motion.div>
                                        )}


                                        {loadingProjects ? (
                                            <div className="flex flex-col items-center justify-center py-12">
                                                <Loader2 className="w-8 h-8 text-amber-500 animate-spin mb-3" />
                                                <p className="text-gray-400 text-sm">Escaneando proyectos...</p>
                                            </div>
                                        ) : projects.length === 0 ? (
                                            <div className="text-center py-12">
                                                <Package className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                                                <p className="text-gray-400 text-sm">No se encontraron proyectos en este servidor.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {projects.map((project, i) => {
                                                    const typeLabels: Record<string, { label: string; color: string; icon: string }> = {
                                                        'php': { label: 'PHP', color: 'from-indigo-500 to-blue-500', icon: '🐘' },
                                                        'laravel': { label: 'Laravel', color: 'from-red-500 to-rose-500', icon: '🔺' },
                                                        'docker-app-n8n': { label: 'n8n', color: 'from-orange-500 to-amber-500', icon: '⚡' },
                                                        'docker-app-odoo': { label: 'Odoo', color: 'from-purple-500 to-violet-500', icon: '🏢' },
                                                        'docker-app-evolution': { label: 'Evolution', color: 'from-green-500 to-emerald-500', icon: '💬' },
                                                        'docker-app-uptime-kuma': { label: 'Uptime Kuma', color: 'from-teal-500 to-cyan-500', icon: '📊' },
                                                        'docker-app-portainer': { label: 'Portainer', color: 'from-sky-500 to-blue-500', icon: '🐳' },
                                                        'unknown': { label: 'Desconocido', color: 'from-gray-500 to-gray-600', icon: '📦' },
                                                    };
                                                    const typeInfo = typeLabels[project.type] || typeLabels['unknown'];
                                                    const isDeleting = deletingProject === project.name;
                                                    const isRestarting = restartingProject === project.name;

                                                    return (
                                                        <motion.div
                                                            key={project.name}
                                                            initial={{ opacity: 0, y: 10 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            transition={{ delay: i * 0.05 }}
                                                            className="rounded-xl p-4 flex items-center justify-between gap-4 transition-all duration-300"
                                                            style={{
                                                                background: isDeleting ? 'rgba(239, 68, 68, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                                                                border: isDeleting ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(255, 255, 255, 0.06)',
                                                            }}
                                                        >
                                                            <div className="flex items-center gap-4 flex-1 min-w-0">
                                                                {/* Type icon */}
                                                                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${typeInfo.color} flex items-center justify-center flex-shrink-0`}>
                                                                    <span className="text-lg">{typeInfo.icon}</span>
                                                                </div>

                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <h4 className="text-white font-bold text-sm truncate">{project.name}</h4>
                                                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{
                                                                            background: `linear-gradient(135deg, ${typeInfo.color.includes('indigo') ? '#6366f1' : typeInfo.color.includes('red') ? '#ef4444' : typeInfo.color.includes('orange') ? '#f97316' : typeInfo.color.includes('green') ? '#22c55e' : typeInfo.color.includes('purple') ? '#a855f7' : typeInfo.color.includes('teal') ? '#14b8a6' : typeInfo.color.includes('sky') ? '#0ea5e9' : '#6b7280'}22, transparent)`,
                                                                            color: typeInfo.color.includes('indigo') ? '#818cf8' : typeInfo.color.includes('red') ? '#fb7185' : typeInfo.color.includes('orange') ? '#fdba74' : typeInfo.color.includes('green') ? '#6ee7b7' : typeInfo.color.includes('purple') ? '#c084fc' : typeInfo.color.includes('teal') ? '#5eead4' : typeInfo.color.includes('sky') ? '#7dd3fc' : '#9ca3af',
                                                                        }}>{typeInfo.label}{project.phpVersion && ` ${project.phpVersion}`}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-3 text-xs text-gray-500">
                                                                        {project.domain && (
                                                                            <span className="flex items-center gap-1 truncate"><Globe className="w-3 h-3" />{project.domain}</span>
                                                                        )}
                                                                        <span className="flex items-center gap-1">
                                                                            <Activity className={`w-3 h-3 ${project.containersRunning > 0 ? 'text-green-400' : 'text-gray-600'}`} />
                                                                            {project.containersRunning}/{project.containersTotal}
                                                                        </span>
                                                                        {project.size && <span>{project.size}</span>}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Actions */}
                                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                                {deleteConfirm === project.name ? (
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-xs text-red-400 font-medium">¿Seguro?</span>
                                                                        <motion.button
                                                                            whileHover={{ scale: 1.05 }}
                                                                            whileTap={{ scale: 0.95 }}
                                                                            onClick={() => handleDeleteProject(project.name)}
                                                                            className="px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                                                                            style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
                                                                        >
                                                                            Sí, eliminar
                                                                        </motion.button>
                                                                        <motion.button
                                                                            whileHover={{ scale: 1.05 }}
                                                                            whileTap={{ scale: 0.95 }}
                                                                            onClick={() => setDeleteConfirm(null)}
                                                                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400"
                                                                            style={{ background: 'rgba(255,255,255,0.05)' }}
                                                                        >
                                                                            Cancelar
                                                                        </motion.button>
                                                                    </div>
                                                                ) : (
                                                                    <motion.button
                                                                        whileHover={{ scale: 1.05 }}
                                                                        whileTap={{ scale: 0.95 }}
                                                                        onClick={() => setDeleteConfirm(project.name)}
                                                                        disabled={isDeleting}
                                                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
                                                                        style={{
                                                                            background: 'rgba(239, 68, 68, 0.1)',
                                                                            border: '1px solid rgba(239, 68, 68, 0.2)',
                                                                            color: '#f87171',
                                                                        }}
                                                                    >
                                                                        {isDeleting ? (
                                                                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Eliminando...</>
                                                                        ) : (
                                                                            <><Trash2 className="w-3.5 h-3.5" /> Eliminar</>
                                                                        )}
                                                                    </motion.button>
                                                                )}
                                                                {/* Restart button */}
                                                                {deleteConfirm !== project.name && (
                                                                    <motion.button
                                                                        whileHover={{ scale: 1.05 }}
                                                                        whileTap={{ scale: 0.95 }}
                                                                        onClick={() => handleRestartProject(project.name, project.type)}
                                                                        disabled={isRestarting || isDeleting}
                                                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
                                                                        style={{
                                                                            background: 'rgba(59, 130, 246, 0.1)',
                                                                            border: '1px solid rgba(59, 130, 246, 0.2)',
                                                                            color: '#60a5fa',
                                                                        }}
                                                                    >
                                                                        {isRestarting ? (
                                                                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reiniciando...</>
                                                                        ) : (
                                                                            <><RefreshCw className="w-3.5 h-3.5" /> Reiniciar</>
                                                                        )}
                                                                    </motion.button>
                                                                )}
                                                                
                                                                {/* Migrate button */}
                                                                {deleteConfirm !== project.name && (
                                                                     <motion.button
                                                                     whileHover={{ scale: 1.05 }}
                                                                     whileTap={{ scale: 0.95 }}
                                                                     onClick={() => {
                                                                         setMigratingProject({ name: project.name, type: project.type });
                                                                         setTargetCreds({ host: "", username: "root", password: "" });
                                                                         setNewDomain("");
                                                                         setMigrationLogs([]);
                                                                     }}
                                                                     disabled={isRestarting || isDeleting}
                                                                     className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
                                                                     style={{
                                                                         background: 'rgba(139, 92, 246, 0.1)',
                                                                         border: '1px solid rgba(139, 92, 246, 0.2)',
                                                                         color: '#a78bfa',
                                                                     }}
                                                                 >
                                                                     <Upload className="w-3.5 h-3.5" /> Migrar
                                                                 </motion.button>
                                                                )}
                                                            </div>
                                                        </motion.div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* ===== MIGRATION MODAL ===== */}
                <AnimatePresence>
                    {migratingProject && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                        >
                            <motion.div
                                initial={{ scale: 0.95, y: 20 }}
                                animate={{ scale: 1, y: 0 }}
                                exit={{ scale: 0.95, y: 20 }}
                                className="w-full max-w-3xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
                                style={{
                                    background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95), rgba(15, 23, 42, 0.8))',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset'
                                }}
                            >
                                {/* Modal Header */}
                                <div className="px-6 py-4 flex items-center justify-between border-b border-white/10" style={{ background: 'rgba(255,255,255,0.02)' }}>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center">
                                            <Upload className="w-4 h-4 text-white" />
                                        </div>
                                        Clonar / Migrar Proyecto: <span className="text-purple-400">{migratingProject.name}</span>
                                    </h3>
                                    <button
                                        onClick={() => !isMigrating && setMigratingProject(null)}
                                        disabled={isMigrating}
                                        className="text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                {/* Modal Body */}
                                <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                                    <div className="grid md:grid-cols-2 gap-6">
                                        {/* Left Side - Target Server Config */}
                                        <div className="space-y-4">
                                            <h4 className="text-sm font-semibold text-gray-300 border-b border-white/10 pb-2 mb-3">Servidor de Destino</h4>
                                            
                                            <div className="space-y-1.5">
                                                <label className="block text-xs font-medium text-gray-400">IP / Host</label>
                                                <input
                                                    type="text"
                                                    disabled={isMigrating}
                                                    placeholder="Target Server IP"
                                                    value={targetCreds.host}
                                                    onChange={(e) => setTargetCreds({ ...targetCreds, host: e.target.value })}
                                                    className="w-full px-4 py-2.5 rounded-xl text-white placeholder-gray-500 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-300 disabled:opacity-50"
                                                    style={{ background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1.5">
                                                    <label className="block text-xs font-medium text-gray-400">User</label>
                                                    <input
                                                        type="text"
                                                        disabled={isMigrating}
                                                        value={targetCreds.username}
                                                        onChange={(e) => setTargetCreds({ ...targetCreds, username: e.target.value })}
                                                        className="w-full px-4 py-2.5 rounded-xl text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-300 disabled:opacity-50"
                                                        style={{ background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="block text-xs font-medium text-gray-400">Password</label>
                                                    <input
                                                        type="password"
                                                        disabled={isMigrating}
                                                        placeholder="••••••••"
                                                        value={targetCreds.password}
                                                        onChange={(e) => setTargetCreds({ ...targetCreds, password: e.target.value })}
                                                        className="w-full px-4 py-2.5 rounded-xl text-white placeholder-gray-500 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-300 disabled:opacity-50"
                                                        style={{ background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Domain Injector - Available for all project types */}
                                            <div className="space-y-1.5 pt-2">
                                                <h4 className="text-sm font-semibold text-gray-300 border-b border-white/10 pb-2 mb-3 mt-2">Configuración del Proyecto</h4>
                                                <label className="block text-xs font-medium text-gray-400">Nuevo Dominio <span className="text-gray-500">(Opcional)</span></label>
                                                <input
                                                    type="text"
                                                    disabled={isMigrating}
                                                    placeholder="nuevo-dominio.com"
                                                    value={newDomain}
                                                    onChange={(e) => setNewDomain(e.target.value)}
                                                    className="w-full px-4 py-2.5 rounded-xl text-white placeholder-gray-500 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-300 disabled:opacity-50"
                                                    style={{ background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                                                />
                                                <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">Si provees un dominio, se configurará automáticamente con <code className="text-purple-400/80 bg-purple-400/10 px-1 rounded">Traefik</code> (SSL/HTTPS). Si el proyecto ya tiene dominio, se reemplazará. Si no tiene, se inyectarán las labels de Traefik al <code className="text-purple-400/80 bg-purple-400/10 px-1 rounded">docker-compose.yml</code>.</p>
                                            </div>
                                            
                                            <motion.button
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                                onClick={handleMigrate}
                                                disabled={isMigrating || !targetCreds.host || !targetCreds.password}
                                                className="w-full mt-4 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 text-white transition-all disabled:opacity-50"
                                                style={{
                                                    background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                                                    boxShadow: '0 10px 30px -10px rgba(168, 85, 247, 0.4)',
                                                }}
                                            >
                                                {isMigrating ? <><Loader2 className="w-4 h-4 animate-spin" /> Migrando...</> : <><Rocket className="w-4 h-4 fill-current"/> Iniciar Migración</>}
                                            </motion.button>
                                        </div>

                                        {/* Right Side - Logs */}
                                        <div className="flex flex-col h-[350px] rounded-xl overflow-hidden border border-white/10" style={{ background: 'rgba(0,0,0,0.6)' }}>
                                            <div className="px-4 py-2 border-b border-white/10" style={{ background: 'rgba(255,255,255,0.05)' }}>
                                                <span className="text-xs text-gray-400 font-mono flex items-center gap-2"><Terminal className="w-3.5 h-3.5" /> Migration Terminal</span>
                                            </div>
                                            <div className="p-4 flex-1 overflow-y-auto custom-scrollbar font-mono text-xs">
                                                {migrationLogs.length === 0 ? (
                                                    <div className="text-gray-600 h-full flex items-center justify-center italic">Esperando iniciar...</div>
                                                ) : (
                                                    migrationLogs.map((log, i) => (
                                                        <div key={i} className={`mb-1.5 break-all ${log.includes('❌') ? 'text-red-400' : log.includes('✅') || log.includes('✓') ? 'text-green-400' : 'text-gray-300'}`}>
                                                            <span className="text-purple-500 mr-2 select-none">❯</span>{log}
                                                        </div>
                                                    ))
                                                )}
                                                <div ref={migrationLogsEndRef} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
                
                {(step === "deploying" || step === "success" || step === "error") && (
                    <motion.div
                        key="console"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full"
                    >
                        <div
                            className="rounded-3xl overflow-hidden"
                            style={{
                                background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.6))',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                            }}
                        >
                            {/* Header with timer */}
                            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between" style={{ background: 'rgba(0,0,0,0.3)' }}>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-red-500/80" />
                                    <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                                    <div className="w-3 h-3 rounded-full bg-green-500/80" />
                                </div>
                                <div className="text-gray-500 text-xs font-mono uppercase tracking-widest flex items-center gap-2">
                                    <Terminal className="w-4 h-4" />
                                    Live System Log
                                </div>
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                                    <span className="text-xs font-mono text-gray-300">
                                        {Math.floor(elapsedTime / 60).toString().padStart(2, '0')}
                                        <span className={step === 'deploying' ? 'timer-dot' : ''}>:</span>
                                        {(elapsedTime % 60).toString().padStart(2, '0')}
                                    </span>
                                </div>
                            </div>

                            {/* Grid Layout for Logs and Result */}
                            <div className="grid lg:grid-cols-3">
                                {/* Terminal */}
                                <div className="lg:col-span-2 bg-black/60 font-mono text-sm p-6 h-[500px] overflow-y-auto custom-scrollbar">
                                    {logs.map((log, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className="mb-2 break-all text-gray-300 border-l-2 border-transparent hover:border-blue-500/50 pl-3 py-1 transition-colors"
                                        >
                                            <span className="text-blue-400 mr-2 select-none">❯</span>
                                            {log}
                                        </motion.div>
                                    ))}
                                    <div ref={logsEndRef} />
                                </div>

                                {/* Status/Result Panel */}
                                <div className="p-6 border-l border-white/5" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.02), transparent)' }}>
                                    <div className="h-full flex flex-col">

                                        {/* ===== DEPLOYING VIEW ===== */}
                                        {step === 'deploying' && (
                                            <div className="flex-1 flex flex-col">
                                                <h3 className="text-lg font-bold mb-6 text-white flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center step-active">
                                                        <Cpu className="w-5 h-5 text-white" />
                                                    </div>
                                                    Desplegando...
                                                </h3>

                                                {/* Stepper */}
                                                <div className="space-y-1 flex-1">
                                                    {deploySteps.map((s, i) => (
                                                        <motion.div
                                                            key={s.id}
                                                            initial={{ opacity: 0, x: 10 }}
                                                            animate={{ opacity: 1, x: 0 }}
                                                            transition={{ delay: i * 0.08 }}
                                                            className="flex items-center gap-3 py-2.5 px-3 rounded-xl transition-all duration-500"
                                                            style={{
                                                                background: s.status === 'active' ? 'rgba(59, 130, 246, 0.1)' : s.status === 'done' ? 'rgba(34, 197, 94, 0.05)' : 'transparent',
                                                                border: s.status === 'active' ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid transparent',
                                                            }}
                                                        >
                                                            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-500" style={{
                                                                background: s.status === 'done' ? 'linear-gradient(135deg, #22c55e, #10b981)' : s.status === 'active' ? 'linear-gradient(135deg, #3b82f6, #6366f1)' : 'rgba(255,255,255,0.05)',
                                                            }}>
                                                                {s.status === 'done' ? (
                                                                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>
                                                                        <CheckCircle2 className="w-4 h-4 text-white" />
                                                                    </motion.div>
                                                                ) : s.status === 'active' ? (
                                                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                                ) : (
                                                                    <span className="text-sm">{s.icon}</span>
                                                                )}
                                                            </div>
                                                            <span className={`text-sm font-medium transition-colors duration-300 ${s.status === 'done' ? 'text-green-400' : s.status === 'active' ? 'text-white' : 'text-gray-600'
                                                                }`}>
                                                                {s.label}
                                                            </span>
                                                        </motion.div>
                                                    ))}
                                                </div>

                                                {/* Progress bar */}
                                                <div className="mt-4">
                                                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                                                        <motion.div
                                                            className="h-full rounded-full"
                                                            style={{ background: 'linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4)' }}
                                                            initial={{ width: '0%' }}
                                                            animate={{ width: `${(deploySteps.filter(s => s.status === 'done').length / deploySteps.length) * 100}%` }}
                                                            transition={{ duration: 0.5, ease: 'easeOut' }}
                                                        />
                                                    </div>
                                                    <p className="text-xs text-gray-500 mt-2 text-center">
                                                        {deploySteps.filter(s => s.status === 'done').length} / {deploySteps.length} pasos
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        {/* ===== ERROR VIEW ===== */}
                                        {step === 'error' && (
                                            <div className="flex-1 flex flex-col">
                                                <h3 className="text-lg font-bold mb-4 text-white flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center">
                                                        <XCircle className="w-5 h-5 text-white" />
                                                    </div>
                                                    Error
                                                </h3>

                                                <div className="p-4 rounded-xl mb-4" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                                    <p className="text-red-400 text-sm font-semibold mb-2 flex items-center gap-2">
                                                        <XCircle className="w-4 h-4" /> Deployment Failed
                                                    </p>
                                                    <p className="text-gray-300 text-xs font-mono break-all leading-relaxed">
                                                        {errorMessage || "An unexpected error occurred"}
                                                    </p>
                                                </div>

                                                {/* Elapsed time on error */}
                                                <div className="p-3 rounded-xl mb-4 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                                    <Clock className="w-4 h-4 text-gray-500" />
                                                    <span className="text-xs text-gray-400">Duración: <span className="text-white font-mono">{Math.floor(elapsedTime / 60)}m {elapsedTime % 60}s</span></span>
                                                </div>

                                                {/* Tips */}
                                                <div className="p-3 rounded-xl mb-4" style={{ background: 'rgba(251, 191, 36, 0.05)', border: '1px solid rgba(251, 191, 36, 0.15)' }}>
                                                    <p className="text-yellow-400/80 text-xs font-semibold mb-2">💡 Sugerencias</p>
                                                    <ul className="text-xs text-gray-400 space-y-1.5 list-none">
                                                        <li>• Verifica las credenciales SSH</li>
                                                        <li>• Confirma que el servidor es accesible</li>
                                                        <li>• Revisa los logs para más detalles</li>
                                                    </ul>
                                                </div>

                                                <div className="flex-1" />

                                                <div className="flex gap-2">
                                                    <motion.button
                                                        whileHover={{ scale: 1.02 }}
                                                        whileTap={{ scale: 0.98 }}
                                                        onClick={handleDeploy}
                                                        className="flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-white"
                                                        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
                                                    >
                                                        <RefreshCw className="w-4 h-4" />
                                                        Reintentar
                                                    </motion.button>
                                                    <motion.button
                                                        whileHover={{ scale: 1.02 }}
                                                        whileTap={{ scale: 0.98 }}
                                                        onClick={() => { setStep('config'); setLogs([]); setResult(null); setErrorMessage(''); setSqlFileName(''); }}
                                                        className="flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-white"
                                                        style={{
                                                            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                                            boxShadow: '0 10px 30px -10px rgba(99, 102, 241, 0.4)',
                                                        }}
                                                    >
                                                        <ArrowLeft className="w-4 h-4" />
                                                        Volver
                                                    </motion.button>
                                                </div>
                                            </div>
                                        )}

                                        {/* ===== SUCCESS VIEW ===== */}
                                        {step === 'success' && result && (
                                            <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar -mr-2 pr-2">
                                                {/* Success header */}
                                                <div className="text-center mb-5">
                                                    <motion.div
                                                        initial={{ scale: 0 }}
                                                        animate={{ scale: 1 }}
                                                        transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
                                                        className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mx-auto mb-3 success-glow"
                                                    >
                                                        <Sparkles className="w-7 h-7 text-white" />
                                                    </motion.div>
                                                    <motion.h3
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: 0.2 }}
                                                        className="text-lg font-bold text-white"
                                                    >
                                                        ¡Deploy Completado!
                                                    </motion.h3>
                                                    <motion.p
                                                        initial={{ opacity: 0 }}
                                                        animate={{ opacity: 1 }}
                                                        transition={{ delay: 0.3 }}
                                                        className="text-xs text-gray-400 mt-1"
                                                    >
                                                        Completado en {Math.floor(elapsedTime / 60)}m {elapsedTime % 60}s
                                                    </motion.p>
                                                </div>

                                                <div className="space-y-3">
                                                    {/* URL */}
                                                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
                                                        className="result-card p-3 rounded-xl" style={{ background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                                                        <div className="flex items-center justify-between mb-1.5">
                                                            <p className="text-green-400 text-xs font-semibold flex items-center gap-1"><Globe className="w-3 h-3" /> URL Pública</p>
                                                            <div className="flex items-center gap-1">
                                                                <button onClick={() => copyToClipboard(result.url, 'url')} className={`copy-btn ${copiedField === 'url' ? 'copied' : ''}`} title="Copiar">
                                                                    {copiedField === 'url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                                                </button>
                                                                <a href={result.url} target="_blank" className="copy-btn" title="Abrir"><ExternalLink className="w-3.5 h-3.5" /></a>
                                                            </div>
                                                        </div>
                                                        <p className="text-white text-sm font-mono break-all">{result.url}</p>
                                                    </motion.div>

                                                    {/* App name */}
                                                    {result.app_name && (
                                                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                                                            className="result-card p-3 rounded-xl" style={{ background: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                                                            <div className="flex items-center justify-between mb-1.5">
                                                                <p className="text-purple-400 text-xs font-semibold">App</p>
                                                                <button onClick={() => copyToClipboard(result.app_name, 'app')} className={`copy-btn ${copiedField === 'app' ? 'copied' : ''}`}>{copiedField === 'app' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</button>
                                                            </div>
                                                            <p className="text-white text-sm font-semibold">{result.app_name}</p>
                                                        </motion.div>
                                                    )}

                                                    {/* API Key */}
                                                    {result.api_key && (
                                                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
                                                            className="result-card p-3 rounded-xl" style={{ background: 'rgba(249, 115, 22, 0.08)', border: '1px solid rgba(249, 115, 22, 0.2)' }}>
                                                            <div className="flex items-center justify-between mb-1.5">
                                                                <p className="text-orange-400 text-xs font-semibold">API Key</p>
                                                                <button onClick={() => copyToClipboard(result.api_key, 'apikey')} className={`copy-btn ${copiedField === 'apikey' ? 'copied' : ''}`}>{copiedField === 'apikey' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</button>
                                                            </div>
                                                            <p className="text-white text-xs font-mono break-all">{result.api_key}</p>
                                                        </motion.div>
                                                    )}

                                                    {/* Database credentials */}
                                                    {result.db_name && (
                                                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
                                                            className="result-card p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                            <div className="flex items-center justify-between mb-3">
                                                                <p className="text-gray-400 text-xs font-semibold flex items-center gap-1"><Database className="w-3 h-3" /> Base de Datos</p>
                                                            </div>
                                                            <div className="space-y-2 text-xs font-mono">
                                                                {[
                                                                    { label: 'Host', value: result.db_host, key: 'dbhost' },
                                                                    { label: 'Port', value: result.db_port, key: 'dbport' },
                                                                    { label: 'Name', value: result.db_name, key: 'dbname' },
                                                                    { label: 'User', value: result.db_user, key: 'dbuser' },
                                                                    { label: 'Pass', value: result.db_pass, key: 'dbpass' },
                                                                ].filter(item => item.value).map((item) => (
                                                                    <div key={item.label} className="flex items-center justify-between group">
                                                                        <span className="text-gray-500">{item.label}</span>
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-white">{item.value}</span>
                                                                            <button
                                                                                onClick={() => copyToClipboard(String(item.value), item.key)}
                                                                                className={`copy-btn ${copiedField === item.key ? 'copied' : ''}`}
                                                                                style={{ padding: '3px' }}
                                                                            >
                                                                                {copiedField === item.key ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </motion.div>
                                                    )}

                                                    {/* Git info */}
                                                    {result.git_repo && result.git_repo !== '' && (
                                                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
                                                            className="result-card p-3 rounded-xl" style={{ background: 'rgba(34, 197, 94, 0.05)', border: '1px solid rgba(34, 197, 94, 0.15)' }}>
                                                            <div className="flex items-center justify-between mb-2">
                                                                <p className="text-green-400 text-xs font-semibold flex items-center gap-1"><GitBranch className="w-3 h-3" /> Git</p>
                                                                <button onClick={() => copyToClipboard(result.git_repo, 'gitrepo')} className={`copy-btn ${copiedField === 'gitrepo' ? 'copied' : ''}`}>{copiedField === 'gitrepo' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</button>
                                                            </div>
                                                            <p className="text-gray-300 text-xs font-mono break-all mb-1">{result.git_repo}</p>
                                                            {result.deploy_script && result.deploy_script !== 'none' && (
                                                                <div className="flex items-center justify-between">
                                                                    <p className="text-gray-500 text-xs">Deploy: <code className="text-green-400/80">{result.deploy_script}</code></p>
                                                                    <button onClick={() => copyToClipboard(result.deploy_script, 'deployscript')} className={`copy-btn ${copiedField === 'deployscript' ? 'copied' : ''}`} style={{ padding: '3px' }}>{copiedField === 'deployscript' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}</button>
                                                                </div>
                                                            )}
                                                        </motion.div>
                                                    )}
                                                </div>

                                                {/* Action button */}
                                                <motion.button
                                                    initial={{ opacity: 0, y: 8 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: 0.5 }}
                                                    whileHover={{ scale: 1.02 }}
                                                    whileTap={{ scale: 0.98 }}
                                                    onClick={() => { setStep('config'); setLogs([]); setResult(null); setSqlFileName(''); }}
                                                    className="w-full mt-4 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 flex-shrink-0"
                                                    style={{
                                                        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                                        boxShadow: '0 10px 30px -10px rgba(99, 102, 241, 0.4)',
                                                    }}
                                                >
                                                    <Rocket className="w-4 h-4" />
                                                    Desplegar Otro
                                                </motion.button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
