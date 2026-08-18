import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSchemaChangesFromCode } from '../ef/efSchemaInspector';

describe('efSchemaInspector', () => {
  it('parses CreateTable and AddColumn changes', () => {
    const code = `
using Microsoft.EntityFrameworkCore.Migrations;

namespace TestApp.Migrations
{
    public partial class AddOrders : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Orders",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    CustomerName = table.Column<string>(type: "text", nullable: true)
                });

            migrationBuilder.AddColumn<string>(
                name: "Email",
                table: "Users",
                type: "character varying(255)",
                nullable: false);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "Orders");
            migrationBuilder.DropColumn(name: "Email", table: "Users");
        }
    }
}
`;
    const summary = parseSchemaChangesFromCode(code);
    assert.strictEqual(summary.totalChanges, 2);
    assert.strictEqual(summary.changes[0].type, 'create-table');
    assert.strictEqual(summary.changes[0].target, 'Orders');
    assert.strictEqual(summary.changes[1].type, 'add-column');
    assert.strictEqual(summary.changes[1].target, 'Users.Email');
  });

  it('parses ForeignKeys, Indexes and Raw SQL', () => {
    const code = `
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddForeignKey(
                name: "FK_Orders_Users_UserId",
                table: "Orders",
                column: "UserId",
                principalTable: "Users",
                principalColumn: "Id");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Email",
                table: "Users",
                column: "Email",
                unique: true);

            migrationBuilder.Sql("CREATE VIEW V_OrderSummary AS SELECT * FROM Orders;");
        }
`;
    const summary = parseSchemaChangesFromCode(code);
    assert.strictEqual(summary.totalChanges, 3);
    assert.strictEqual(summary.hasRawSql, true);
    assert.ok(summary.changes.some(c => c.type === 'add-fk'));
    assert.ok(summary.changes.some(c => c.type === 'create-index'));
    assert.ok(summary.changes.some(c => c.type === 'raw-sql'));
  });

  it('handles empty migration gracefully', () => {
    const code = `
        protected override void Up(MigrationBuilder migrationBuilder)
        {
        }
`;
    const summary = parseSchemaChangesFromCode(code);
    assert.strictEqual(summary.totalChanges, 0);
    assert.strictEqual(summary.hasRawSql, false);
  });
});
