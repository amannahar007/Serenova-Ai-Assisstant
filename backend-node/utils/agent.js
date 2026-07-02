const axios = require('axios');

async function executeAgentWorkflow(task, sessionId, llmCaller) {
    console.log(`Agent starting task: ${task}`);
    
    // Step 1: Analyze & Break down
    const planPrompt = `System: You are an autonomous agent. Break down the following task into 3 distinct logical steps: "${task}". Format as a JSON array of strings only.`;
    const planResponse = await llmCaller([{ role: "system", content: planPrompt }]);
    
    let steps = [];
    try {
        // Simple extraction in case LLM doesn't return pure JSON
        const jsonMatch = planResponse.match(/\[.*\]/s);
        steps = JSON.parse(jsonMatch ? jsonMatch[0] : '[]');
    } catch (e) {
        steps = ["Analyze requirement", "Process information", "Generate final result"];
    }

    const logs = [];
    let currentContext = "";

    // Step 2: Sequential Execution
    for (const step of steps) {
        logs.push({ step, status: "executing" });
        console.log(`Executing step: ${step}`);
        
        const stepPrompt = `System: Task: ${task}. Context so far: ${currentContext}. Current Step: ${step}. Execute this step and provide the result.`;
        const stepResult = await llmCaller([{ role: "system", content: stepPrompt }]);
        
        currentContext += `\n- ${step}: ${stepResult}`;
        logs[logs.length - 1].status = "completed";
        logs[logs.length - 1].result = stepResult;
    }

    // Step 3: Summarize
    const finalPrompt = `System: Based on the following execution logs, provide a final comprehensive answer to the original task: "${task}". Logs: ${currentContext}`;
    const finalResult = await llmCaller([{ role: "system", content: finalPrompt }]);

    return {
        task,
        steps: logs,
        finalResult
    };
}

module.exports = { executeAgentWorkflow };
