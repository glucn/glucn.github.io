---
title: "Create AWS RDS MySQL instance with a secured master password using CloudFormation template"
date: 2020-10-13T00:00:00
draft: false
---

![](https://miro.medium.com/v2/resize:fit:1100/format:webp/1*nPzaOvAqjxvN8Uze5kRQ1Q.jpeg)

*Originally posted on [Medium](https://levelup.gitconnected.com/create-aws-rds-mysql-instance-with-a-secured-master-password-using-cloudformation-template-c3a767062972).*

Recently, I’m working on creating a MySQL RDS instance with CloudFormation template. Although there have been tons of documents from both AWS officials or the community talking about this, I feel there are not many documents diving deep about making `MasterUserPassword` secure.

When creating a MySQL instance, RDS will create a “master user” with [all the permissions](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.MasterAccounts.html) needed for managing the database. Disregarding the [CloudFormation reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-rds-database-instance.html#cfn-rds-dbinstance-masterusername) saying `MasterUsername` and `MasterUserPassword` are not required, they are required to create a MySQL RDS instance. You will get an error `“Property MasterUserPassword cannot be empty”` if they’re not provided in the template. It might be okay to put a plaintext password in a temporary template that will be thrown away, but I must be crazy to do that if I’m going to commit the template to any source control system. Also, I’d like to store that password safely at somewhere better than a sticky note.

Here the question comes: how can I specify a `MasterUserPassword` that is not plaintext and can be stored on AWS? The answer is another AWS service — Secrets Manager.

I’m not going to write up what is already in Secrets Manager’s [official documents](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html). Instead, let’s jump to the conclusion that we will need a Secret in Secrets Manager, a KMS key for encrypting and decrypting the secret, and a way to use the Secret when creating the RDS instance.

And here is the CloudFormation template:

```
---
Parameters:
  MySQLMasterUserName:
    Type: String
    Default: admin
    Description: Database admin user name for MySQL
Resources:
  MySQLSecretKey:
    Type: AWS::KMS::Key
    Properties:
      KeyPolicy:
        Statement:
          - Sid: "Enable IAM User Permissions"
            Effect: "Allow"
            Principal:
              AWS: !Sub arn:aws:iam::${AWS::AccountId}:root
            Action: "kms:*"
            Resource: "*"

  MySQLSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      KmsKeyId: !Ref MySQLSecretKey
      GenerateSecretString:
        SecretStringTemplate: !Join [ '', [ '{"username": "', !Ref MySQLMasterUserName, '"}' ] ]
        GenerateStringKey: 'password'
        PasswordLength: 16
        ExcludeCharacters: '"@/\'

  MySQLInstance:
    Type: AWS::RDS::DBInstance
    Properties:
      DBInstanceClass: !Ref MySQLDBInstanceClass
      DBName: !Ref MySQLDBName
      Engine: "MySQL"
      EngineVersion: "8.0.20"
      MasterUsername: !Ref MySQLMasterUserName
      MasterUserPassword: !Join [ '', [ '{{resolve:secretsmanager:', !Ref MySQLSecret, ':SecretString:password}}' ] ]
      StorageType: gp2
      AllocatedStorage: 20
      AvailabilityZone: !GetAtt PrivateSubnet1.AvailabilityZone
      MultiAZ: False
      Port: !Ref MySQLPort
      DBSubnetGroupName: !Ref MySQLSubnetGroup
      PubliclyAccessible: True
      VPCSecurityGroups:
        - !Ref MySQLSecurityGroup
```

There are some elements that I’d like to explain further in this template:

1. The secret will be generated as a JSON string like `{“username”: “admin”, “password”: “super_secure”}`. And RDS will put some other information into this secret as well, like the hostname of the RDS instance, DB name, etc. I can retrieve the password in the AWS console, or do it programmatically by calling API [GetSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html). But since this is the master user credentials, I won’t be using it anywhere in the application, and it should only be used when I need to manage the DB instance.
2. In the template of MySQL instance, referencing the secret in Secrets Manager with `{{resolve:secretsmanager:SECRET_ARN:SecretString:password}}` is the magic ingredient. Please refer to this [documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references.html#dynamic-references-secretsmanager) for some further explanation.

There are some other topics around this template, like associating it with a security group in VPC, automatically rotating the secret, etc. I guess I’ll touch them in later articles then. I hope this article can help you a bit!
