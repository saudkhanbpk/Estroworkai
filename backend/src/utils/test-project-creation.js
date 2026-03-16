const jwt = require('jsonwebtoken');

const SSO_SECRET = 'estrowork-sso-shared-secret-2026-3-5-12';
const MAIN_BACKEND_URL = 'http://localhost:4001/api/v1';

async function testAssignmentWithProject() {
    const email = 'muhammadadil@techcreator.co';
    const containerId = 'test-container-' + Date.now();
    const name = 'Test AI Workspace Name';
    const prompt = 'Test AI Workspace Prompt - Create a beautiful landing page';

    console.log('--- Testing AI Project Assignment & Project Creation ---');
    console.log(`Email: ${email}`);
    console.log(`Container ID: ${containerId}`);
    console.log(`Name: ${name}`);

    // 1. Generate token with name and prompt
    const token = jwt.sign(
        { email, containerId, name, prompt, source: 'estroworkai' },
        SSO_SECRET,
        { expiresIn: '5m' }
    );

    console.log('Generated Token:', token);

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
        console.log('Response Body:', JSON.stringify(result, null, 2));

        if (status === 201 && result.success) {
            console.log('✅ SUCCESS: Assignment and Project creation works!');
            console.log('Project ID:', result.data.project._id);
        } else {
            console.error('❌ FAILURE: Assignment or Project creation failed.');
        }
    } catch (error) {
        console.error('❌ ERROR: Request failed:', error.message);
    }
}

testAssignmentWithProject();
