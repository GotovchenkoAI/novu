import { expect } from 'chai';
import { CommunityAuthService } from './community.auth.service';

describe('Токен подписчика (Djinn)', () => {
  it('не несёт адрес и имена', async () => {
    let signed: Record<string, unknown> = {};
    const service = Object.create(CommunityAuthService.prototype);
    service.jwtService = {
      sign: (payload: Record<string, unknown>) => {
        signed = payload;

        return 'token';
      },
    };

    await service.getSubscriberWidgetToken(
      { _id: 'internal', _organizationId: 'org', _environmentId: 'env', subscriberId: 'sub', email: 'a@example.com', firstName: 'Имя', lastName: 'Фамилия' },
      []
    );

    expect(Object.keys(signed).sort()).to.eql(['_id', 'contextKeys', 'environmentId', 'organizationId', 'subscriberId']);
  });
});
