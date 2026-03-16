const jwt = require('jsonwebtoken');

const SSO_SECRET = 'estrowork-sso-shared-secret-2026-3-5-12';
const MAIN_BACKEND_URL = 'http://localhost:4001/api/v1';

async function testProjectCreationWithClient() {
    const email = 'muhammadadil@techcreator.co'; // This user should exist in the main system
    const containerId = 'test-client-container-' + Date.now();
    const name = 'Project with Client Assignment';
    const prompt = 'Project description with client details assignment';

    console.log('--- Testing Project Creation & Client Assignment ---');
    console.log(`Email (Client): ${email}`);
    console.log(`Project Name: ${name}`);

    // 1. Generate token
    const token = jwt.sign(
        { email, containerId, name, prompt, source: 'estroworkai' },
        SSO_SECRET,
        { expiresIn: '5m' }
    );

    // 2. Send request
    try {
        const response = await fetch(`${MAIN_BACKEND_URL}/ai-projects/assign`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Service-Token': `Bearer ${token}`
            },
            body: JSON.stringify({ email, containerId, name, prompt })
        });

        const status = response.status;
        const result = await response.json();

        console.log(`Response Status: ${status}`);
        
        if (status === 201 && result.success) {
            console.log('✅ SUCCESS: Project created and client assigned!');
            console.log('Project Details:');
            console.log(`- Project ID: ${result.data.project._id}`);
            console.log(`- Project Client: ${result.data.project.projectClient}`);
            console.log(`- Project Clients Array: ${JSON.stringify(result.data.project.projectClients)}`);
            
            if (result.data.project.projectClient) {
                console.log('✅ Client successfully linked to project.');
            } else {
                console.warn('⚠️ Warning: projectClient field is empty.');
            }
        } else {
            console.error('❌ FAILURE:', result.error || 'Assignment failed');
        }
    } catch (error) {
        console.error('❌ ERROR: Request failed:', error.message);
    }
}

testProjectCreationWithClient();
