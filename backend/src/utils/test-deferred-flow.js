const jwt = require('jsonwebtoken');

const SSO_SECRET = 'estrowork-sso-shared-secret-2026-3-5-12';
const MAIN_BACKEND_URL = 'http://localhost:4001/api/v1';

async function testDeferredFlow() {
    const email = 'muhammadadil@techcreator.co';
    const containerId = 'deferred-test-' + Date.now();
    const name = 'Deferred Project Test';
    const prompt = 'Testing deferred project creation on approval';

    console.log('--- Testing Deferred Project Creation Flow ---');
    console.log(`Email: ${email}`);
    console.log(`Container ID: ${containerId}`);

    // 1. Generate token
    const token = jwt.sign(
        { email, containerId, name, prompt, source: 'estroworkai' },
        SSO_SECRET,
        { expiresIn: '5m' }
    );

    // 2. Initiate assignment
    try {
        console.log('Initiating assignment via service-to-service call...');
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
        // console.log('Response Body:', JSON.stringify(result, null, 2));

        if (status === 201 && result.success) {
            console.log('✅ SUCCESS: Handover Request created successfully!');
            console.log('Request ID:', result.data.handoverRequest._id);
            console.log('Status:', result.data.handoverRequest.status);
            
            if (result.data.handoverRequest.projectMetadata) {
                console.log('✅ Found projectMetadata in request.');
                console.log('Metadata Name:', result.data.handoverRequest.projectMetadata.name);
            } else {
                console.error('❌ FAILURE: projectMetadata is missing from HandoverRequest!');
            }

            if (result.data.project) {
                 console.error('❌ FAILURE: A Project was created immediately! It should be deferred.');
            } else {
                 console.log('✅ SUCCESS: No project created immediately. Creation is deferred.');
            }
        } else {
            console.error('❌ FAILURE:', result.error || 'Assignment failed');
        }
    } catch (error) {
        console.error('❌ ERROR: Request failed:', error.message);
    }
}

testDeferredFlow();
