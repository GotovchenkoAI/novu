import { IsDefined, IsString } from 'class-validator';
import { EnvironmentWithUserCommand } from '../../../shared/commands/project.command';

export class GetTransactionStatusCommand extends EnvironmentWithUserCommand {
  @IsDefined()
  @IsString()
  transactionId: string;
}
