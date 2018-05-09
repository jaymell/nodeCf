pipeline {
    agent {
		docker { image 'node:latest' }
    }

    stages {
        stage('Build') {
            steps {
                npm install
            }
        }
        stage('Test') {
            steps {
              npm run integration 
            }
        }
    }
}
