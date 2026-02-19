"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, CheckCircle2, Server, Globe, Shield, Database, ChevronRight, Activity, Cpu, Play, Rocket, Zap, XCircle, ArrowLeft, GitBranch, Code2, Upload, FileText, X } from "lucide-react";

// Types
type ProjectType = "php" | "laravel";
type PHPVersion = "7.3" | "8.3";
type StepType = "config" | "deploying" | "success" | "error";

export default function DeployDashboard() {
    const [step, setStep] = useState<StepType>("config");
    const [logs, setLogs] = useState<string[]>([]);
    const [result, setResult] = useState<any>(null);
    const [errorMessage, setErrorMessage] = useState<string>("");

    // Config State
    const [config, setConfig] = useState({
        projectName: "",
        domain: "",
        type: "php" as ProjectType,
        phpVersion: "8.3" as PHPVersion,
        forceOverwrite: false,
        gitRepoUrl: "", // Para PHP 7.3 y Laravel 8.3
        gitBranch: "", // Rama del repo (main, master, etc.)
        sqlFileContent: "", // Contenido del archivo SQL (solo PHP 7.3)
        withRedis: true, // Redis para Laravel
        withNodeBuild: true, // Compilar assets con Node.js para Laravel
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
        if (config.phpVersion === "8.3" && config.type === "php") {
            setConfig(prev => ({ ...prev, gitRepoUrl: "", gitBranch: "", sqlFileContent: "" }));
            setSqlFileName("");
        }
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

    const handleDeploy = async () => {
        if (!config.projectName || !creds.host || !creds.password) return;

        setStep("deploying");
        setLogs(["🚀 Initializing deployment sequence..."]);
        setErrorMessage("");

        let hasError = false;
        let detectedError = "";

        try {
            const response = await fetch("/api/deploy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    host: creds.host,
                    username: creds.username,
                    password: creds.password,
                    projectConfig: config,
                }),
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
                setStep("error");
            }
        } catch (error: any) {
            setLogs((prev) => [...prev, `❌ Error: ${error.message}`]);
            setErrorMessage(error.message);
            setStep("error");
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
                    <span className="text-white">Deploy Your</span>
                    <br />
                    <span className="gradient-text">PHP Projects</span>
                </h1>

                <p className="text-base md:text-lg text-gray-400 max-w-xl mx-auto leading-relaxed">
                    Automated Docker deployment with Traefik SSL.
                    <span className="text-gray-300"> No terminal required.</span>
                </p>
            </motion.div>

            <AnimatePresence mode="wait">
                {step === "config" && (
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
                            <div className="grid md:grid-cols-2">
                                {/* Left Panel - Project Details */}
                                <div className="p-6 md:p-8 border-b md:border-b-0 md:border-r border-white/5">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                                            <Activity className="w-5 h-5 text-white" />
                                        </div>
                                        <h3 className="text-lg font-bold text-white">Project Configuration</h3>
                                    </div>

                                    <div className="space-y-4">
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

                                        {/* Git Repository URL - Para PHP 7.3 y Laravel 8.3 */}
                                        <AnimatePresence>
                                            {(config.phpVersion === "7.3" || (config.phpVersion === "8.3" && config.type === "laravel")) && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: "auto" }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    transition={{ duration: 0.3 }}
                                                    className="space-y-1.5 overflow-hidden"
                                                >
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
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

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
                                                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                                                                config.withRedis ? 'bg-red-500 border-red-500' : 'border-gray-600'
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
                                                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                                                                config.withNodeBuild ? 'bg-green-500 border-green-500' : 'border-gray-600'
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
                                </div>

                                {/* Right Panel - VPS Credentials */}
                                <div className="p-6 md:p-8 flex flex-col">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                                            <Shield className="w-5 h-5 text-white" />
                                        </div>
                                        <h3 className="text-lg font-bold text-white">VPS Credentials</h3>
                                    </div>

                                    <div className="space-y-4 flex-1">
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
                                        disabled={!config.projectName || !creds.host || !creds.password || (config.type === 'laravel' && config.phpVersion === '8.3' && !config.gitRepoUrl)}
                                        className="w-full mt-6 py-3.5 rounded-xl font-bold text-base flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 text-white"
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
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
                            {[
                                { icon: Server, label: "Docker", color: "from-blue-500 to-cyan-500" },
                                { icon: Globe, label: "Auto SSL", color: "from-green-500 to-emerald-500" },
                                { icon: Database, label: config.type === "laravel" && config.withRedis ? "MySQL + Redis" : "MySQL 8", color: "from-orange-500 to-amber-500" },
                                { icon: Code2, label: config.type === "laravel" ? `Laravel 8.3` : `PHP ${config.phpVersion}`, color: "from-purple-500 to-pink-500" },
                            ].map((feature, i) => (
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
                            {/* Header */}
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
                                <div className="w-16" />
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
                                        <h3 className="text-lg font-bold mb-6 text-white flex items-center gap-3">
                                            {step === 'success' ? (
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                                                    <CheckCircle2 className="w-5 h-5 text-white" />
                                                </div>
                                            ) : step === 'error' ? (
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center">
                                                    <XCircle className="w-5 h-5 text-white" />
                                                </div>
                                            ) : (
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center animate-pulse">
                                                    <Cpu className="w-5 h-5 text-white" />
                                                </div>
                                            )}
                                            Status
                                        </h3>

                                        {step === 'deploying' && (
                                            <div className="flex-1 flex flex-col items-center justify-center">
                                                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'rgba(59, 130, 246, 0.1)', border: '3px solid rgba(59, 130, 246, 0.3)' }}>
                                                    <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                                </div>
                                                <p className="text-gray-400 animate-pulse text-center text-sm">Running automation...</p>
                                            </div>
                                        )}

                                        {step === 'error' && (
                                            <div className="flex-1 flex flex-col">
                                                <div className="p-4 rounded-xl mb-4" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                                    <p className="text-red-400 text-sm font-semibold mb-2">Deployment Failed</p>
                                                    <p className="text-gray-300 text-xs font-mono break-all">
                                                        {errorMessage || "An unexpected error occurred"}
                                                    </p>
                                                </div>

                                                <div className="flex-1" />

                                                <motion.button
                                                    whileHover={{ scale: 1.02 }}
                                                    whileTap={{ scale: 0.98 }}
                                                    onClick={() => { setStep('config'); setLogs([]); setResult(null); setErrorMessage(''); setSqlFileName(''); }}
                                                    className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-white"
                                                    style={{
                                                        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                                        boxShadow: '0 10px 30px -10px rgba(99, 102, 241, 0.4)',
                                                    }}
                                                >
                                                    <ArrowLeft className="w-4 h-4" />
                                                    Back to Config
                                                </motion.button>
                                            </div>
                                        )}

                                        {step === 'success' && result && (
                                            <div className="space-y-4">
                                                <div className="p-3 rounded-xl" style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                                                    <p className="text-green-400 text-xs font-semibold mb-1">Public URL</p>
                                                    <a href={result.url} target="_blank" className="text-white hover:underline flex items-center gap-2 font-mono text-sm">
                                                        {result.url} <Globe className="w-3 h-3 text-green-400" />
                                                    </a>
                                                </div>

                                                <div className="p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                    <p className="text-gray-400 text-xs font-semibold mb-3">Database</p>
                                                    <div className="space-y-2 text-xs font-mono">
                                                        {[
                                                            { label: 'Host', value: result.db_host },
                                                            { label: 'Port', value: result.db_port },
                                                            { label: 'Name', value: result.db_name },
                                                            { label: 'User', value: result.db_user },
                                                            { label: 'Pass', value: result.db_pass },
                                                        ].map((item) => (
                                                            <div key={item.label} className="flex justify-between">
                                                                <span className="text-gray-500">{item.label}</span>
                                                                <span className="text-white">{item.value}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Git info si existe */}
                                                {result.git_repo && result.git_repo !== '' && (
                                                    <div className="p-3 rounded-xl" style={{ background: 'rgba(34, 197, 94, 0.05)', border: '1px solid rgba(34, 197, 94, 0.15)' }}>
                                                        <p className="text-green-400 text-xs font-semibold mb-2 flex items-center gap-1">
                                                            <GitBranch className="w-3 h-3" /> Git Repository
                                                        </p>
                                                        <p className="text-gray-300 text-xs font-mono break-all mb-2">{result.git_repo}</p>
                                                        {result.deploy_script && result.deploy_script !== 'none' && (
                                                            <p className="text-gray-500 text-xs">
                                                                Deploy: <code className="text-green-400/80">{result.deploy_script}</code>
                                                            </p>
                                                        )}
                                                    </div>
                                                )}

                                                <motion.button
                                                    whileHover={{ scale: 1.02 }}
                                                    whileTap={{ scale: 0.98 }}
                                                    onClick={() => { setStep('config'); setLogs([]); setResult(null); setSqlFileName(''); }}
                                                    className="w-full py-3 rounded-xl text-sm font-bold text-white"
                                                    style={{
                                                        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                                        boxShadow: '0 10px 30px -10px rgba(99, 102, 241, 0.4)',
                                                    }}
                                                >
                                                    Deploy Another
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
